const postsCollection = require('../index').db().collection("posts")
const followsCollection = require('../index').db().collection("follows")
const ObjectID = require('mongodb').ObjectID
const User = require('./User')
const sanitizeHTML = require('sanitize-html')
var ImageKit = require("imagekit");
const dotenv = require("dotenv")

var imagekit = new ImageKit({
  publicKey: process.env.PUBLICKEY,
  privateKey: process.env.PRIVATEKEY,
  urlEndpoint: process.env.URLENDPOINT
});

postsCollection.createIndex({ title: "text", body: "text" })

let Post = function (data, userid, requestedPostId) {
  this.data = data
  this.errors = []
  this.userid = userid
  this.requestedPostId = requestedPostId
}

Post.prototype.cleanUp = function () {
  if (typeof (this.data.title) != "string") { this.data.title = "" }
  if (typeof (this.data.body) != "string") { this.data.body = "" }

  // get rid of any bogus properties
  this.data = {
    title: sanitizeHTML(this.data.title.trim(), { allowedTags: [], allowedAttributes: {} }),
    body: sanitizeHTML(this.data.body.trim(), { allowedTags: [], allowedAttributes: {} }),
    createdDate: new Date(),
    author: ObjectID(this.userid),
    img: this.data.imgBuffer
  }
}

Post.prototype.validate = function () {
  if (this.data.title == "") { this.errors.push("You must provide a title.") }
  if (this.data.body == "") { this.errors.push("You must provide post content.") }
}

const uploadImg = async (buffer) => {
  try {
    const result = await imagekit.upload({
      file: buffer, //required
      fileName: "my_file_name1.jpg",   //required
      tags: ["tag1", "tag2"]
    });
    return result
  } catch (error) {
    return null
  }
}

const deleteImg = async (imgId) =>{
  try {
    const result = await imagekit.deleteFile(imgId);
  } catch (error) {
    return null
  }
}   

Post.prototype.create = function () {
  return new Promise(async (resolve, reject) => {
    this.cleanUp()
    this.validate()
    if (!this.errors.length) {
      // save post into database



      const uploadResult = await uploadImg(this.data.img)

      finaldata = {
        title: this.data.title,
        body: this.data.body,
        createdDate: this.data.createdDate,
        author: this.data.author,
        img: uploadResult.url,
        fileId: uploadResult.fileId

      }
      // console.log(finaldata);



      postsCollection.insertOne(finaldata).then((info) => {
        resolve(info.ops[0]._id)
      }).catch(e => {
        this.errors.push("Please try again later.")
        reject(this.errors)
      })
    } else {
      reject(this.errors)
    }
  })
}

Post.prototype.update = function () {
  return new Promise(async (resolve, reject) => {
    try {
      let post = await Post.findSingleById(this.requestedPostId, this.userid)
      if (post.isVisitorOwner) {
        // actually update the db
        let status = await this.actuallyUpdate()
        resolve(status)
      } else {
        reject()
      }
    } catch (e) {
      reject()
    }
  })
}

Post.prototype.actuallyUpdate = function () {
  return new Promise(async (resolve, reject) => {
    this.cleanUp()
    this.validate()
    if (!this.errors.length) {
      await postsCollection.findOneAndUpdate({ _id: new ObjectID(this.requestedPostId) }, { $set: { title: this.data.title, body: this.data.body } })
      resolve("success")
    } else {
      resolve("failure")
    }
  })
}

Post.reusablePostQuery = function (uniqueOperations, visitorId, finalOperations = []) {
  return new Promise(async function (resolve, reject) {
    let aggOperations = uniqueOperations.concat([
      { $lookup: { from: "users", localField: "author", foreignField: "_id", as: "authorDocument" } },
      {
        $project: {
          title: 1,
          body: 1,
          createdDate: 1,
          img: 1,
          fileId: 1,
          authorId: "$author",
          author: { $arrayElemAt: ["$authorDocument", 0] }
        }
      }
    ]).concat(finalOperations)

    let posts = await postsCollection.aggregate(aggOperations).toArray()


    // clean up author property in each post object
    posts = posts.map(function (post) {
      post.isVisitorOwner = post.authorId.equals(visitorId)
      post.authorId = undefined

      post.author = {
        username: post.author.username || "",
        avatar: new User(post.author, true).avatar
      }

      return post
    })

    resolve(posts)
  })
}

Post.findSingleById = function (id, visitorId) {
  return new Promise(async function (resolve, reject) {
    if (typeof (id) != "string" || !ObjectID.isValid(id)) {
      reject()
      return
    }

    let posts = await Post.reusablePostQuery([
      { $match: { _id: new ObjectID(id) } }
    ], visitorId)

    if (posts.length) {
      resolve(posts[0])
    } else {
      reject()
    }
  })
}

Post.findByAuthorId = function (authorId) {
  return Post.reusablePostQuery([
    { $match: { author: authorId } },
    { $sort: { createdDate: -1 } }
  ])
}

Post.delete = function (postIdToDelete, currentUserId) {
  return new Promise(async (resolve, reject) => {
    try {
      let post = await Post.findSingleById(postIdToDelete, currentUserId)
      console.log(post);

      if (post.isVisitorOwner) {
        await postsCollection.deleteOne({ _id: new ObjectID(postIdToDelete) })
        await deleteImg(post.fileId)
        resolve()
      } else {
        reject()
      }
    } catch (e) {
      reject()
    }
  })
}

Post.search = function (searchTerm) {
  return new Promise(async (resolve, reject) => {
    if (typeof (searchTerm) == "string") {
      let posts = await Post.reusablePostQuery([
        { $match: { $text: { $search: searchTerm } } }
      ], undefined, [{ $sort: { score: { $meta: "textScore" } } }])
      resolve(posts)
    } else {
      reject()
    }
  })
}

Post.countPostsByAuthor = function (id) {
  return new Promise(async (resolve, reject) => {
    let postCount = await postsCollection.countDocuments({ author: id })
    resolve(postCount)
  })
}

Post.getFeed = async function (id) {
  // create an array of the user ids that the current user follows
  let followedUsers = await followsCollection.find({ authorId: new ObjectID(id) }).toArray()
  followedUsers = followedUsers.map(function (followDoc) {
    return followDoc.followedId
  })

  // look for posts where the author is in the above array of followed users
  return Post.reusablePostQuery([
    { $match: { author: { $in: followedUsers } } },
    { $sort: { createdDate: -1 } }
  ])
}

module.exports = Post

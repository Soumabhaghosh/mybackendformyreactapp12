const User = require("../models/User")
const Post = require("../models/Post")
const Follow = require("../models/Follow")
const jwt = require("jsonwebtoken")

// how long a token lasts before expiring
const tokenLasts = "30d"
const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 60 });

exports.apiGetPostsByUsername = async function (req, res) {
  try {
    let authorDoc = await User.findByUsername(req.params.username)
    let posts = await Post.findByAuthorId(authorDoc._id)
    //res.header("Cache-Control", "max-age=10").json(posts)
    res.json(posts)
  } catch (e) {
    res.status(500).send("Sorry, invalid user requested.")
  }
}

exports.checkToken = function (req, res) {
  try {
    req.apiUser = jwt.verify(req.body.token, process.env.JWTSECRET)
    res.json(true)
  } catch (e) {
    res.json(false)
  }
}

exports.apiMustBeLoggedIn = function (req, res, next) {
  try {

    req.apiUser = jwt.verify(req.body.token, process.env.JWTSECRET)
    next()
  } catch (e) {
    res.status(500).send("Sorry, you must provide a valid token.")
  }
}

exports.doesUsernameExist = function (req, res) {
  User.findByUsername(req.body.username.toLowerCase())
    .then(function () {
      res.json(true)
    })
    .catch(function (e) {
      res.json(false)
    })
}

exports.doesEmailExist = async function (req, res) {
  let emailBool = await User.doesEmailExist(req.body.email)
  res.json(emailBool)
}

exports.sharedProfileData = async function (req, res, next) {
  let viewerId
  try {
    viewer = jwt.verify(req.body.token, process.env.JWTSECRET)
    viewerId = viewer._id
  } catch (e) {
    viewerId = 0
  }
  req.isFollowing = await Follow.isVisitorFollowing(req.profileUser._id, viewerId)

  let postCountPromise = Post.countPostsByAuthor(req.profileUser._id)
  let followerCountPromise = Follow.countFollowersById(req.profileUser._id)
  let followingCountPromise = Follow.countFollowingById(req.profileUser._id)
  let [postCount, followerCount, followingCount] = await Promise.all([postCountPromise, followerCountPromise, followingCountPromise])

  req.postCount = postCount
  req.followerCount = followerCount
  req.followingCount = followingCount

  next()
}

exports.apiLogin = function (req, res) {
  let user = new User(req.body)
  user
    .login()
    .then(function (result) {
      res.json({
        token: jwt.sign({ _id: user.data._id, username: user.data.username, avatar: user.avatar }, process.env.JWTSECRET, { expiresIn: tokenLasts }),
        username: user.data.username,
        avatar: user.avatar
      })
    })
    .catch(function (e) {
      res.json(false)
    })
}

exports.apiRegister = function (req, res) {
  let user = new User(req.body)
  user
    .register()
    .then(() => {
      res.json({
        token: jwt.sign({ _id: user.data._id, username: user.data.username, avatar: user.avatar }, process.env.JWTSECRET, { expiresIn: tokenLasts }),
        username: user.data.username,
        avatar: user.avatar
      })
    })
    .catch(regErrors => {
      res.status(500).send(regErrors)
    })
}

exports.apiGetHomeFeed = async function (req, res) {
  try {
    let posts = await Post.getFeed(req.apiUser._id)
    res.json(posts)
  } catch (e) {
    res.status(500).send("Error")
  }
}

exports.ifUserExists = function (req, res, next) {
  User.findByUsername(req.params.username)
    .then(function (userDocument) {
      req.profileUser = userDocument
      next()
    })
    .catch(function (e) {
      res.json(false)
    })
}

exports.profileBasicData = function (req, res) {
  res.json({
    profileUsername: req.profileUser.username,
    profileAvatar: req.profileUser.avatar,
    isFollowing: req.isFollowing,
    counts: { postCount: req.postCount, followerCount: req.followerCount, followingCount: req.followingCount }
  })
}

exports.profileFollowers = async function (req, res) {
  try {
    let followers = await Follow.getFollowersById(req.profileUser._id)
    //res.header("Cache-Control", "max-age=10").json(followers)
    res.json(followers)
  } catch (e) {
    res.status(500).send("Error")
  }
}

exports.profileFollowing = async function (req, res) {
  try {
    let following = await Follow.getFollowingById(req.profileUser._id)
    //res.header("Cache-Control", "max-age=10").json(following)
    res.json(following)
  } catch (e) {
    res.status(500).send("Error")
  }
}


const nodemailer = require('nodemailer');

// Create transporter using your Gmail credentials
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'soumagok@gmail.com',
    pass: 'jgzt swei soqj tqyx'  // Use App Password, not your actual password
  }
});

exports.forgetPassword = async function (req, res) {

  try {
    let emailBool = await User.doesEmailExist(req.body.email)

    if (emailBool) {

      const random6DigitStr = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');

      cache.set(emailBool.email, random6DigitStr);

      const value = cache.get(emailBool.email);

      const mailOptions = {
        from: 'soumagok@gmail.com',
        to: req.body.email,
        subject: 'Reset Your Password - Memobook',
        text: `Hi ,

We received a request to reset your password for your Memobook account.

To reset your password, please copy the code below:
${value}

If you did not request a password reset, you can safely ignore this email.

This code will expire in 1 minute for your security.

Thanks,  
The Memobook Team`
      };

      // Send the mail

      await new Promise((resolve, reject) => {
        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
           
            res.status(400).send(error);
             resolve()
          } else {
            
            res.status(200).send('Email sent:');
            reject()
          }
        });
      });




    }
    else {
      res.json("Email Not Found")
    }
  } catch (error) {
    res.json(error)
  }


}

exports.createNewPassword = async function (req, res) {
  if (cache.get(req.body.email) == req.body.key) {

    try {
      await User.changePassword(req.body.email, req.body.newpassword)
      res.json("Passowrd changed");

    } catch (error) {
      res.json(error)
    }


  }
  else {
    res.json("Wrong Code or EmailId");

  }
}

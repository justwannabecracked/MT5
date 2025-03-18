const jwt = require("jsonwebtoken");
const authMiddleware = (req, res, next) => {
  const token = req.header("x-auth-token");

  if (!token) {
    return res.status(401).json({
      msg: "No Token, Authorization Denied",
      status: false,
    });
  }

  try {
    const payload = jwt.verify(token, process.env.SECRET);
    req.user = payload.user;
    next();
  } catch (error) {
    return res.status(401).json({
      data: error,
      msg: "Not Authorized, Please Enter a Valid Token",
      status: false,
    });
  }
};
module.exports = authMiddleware;

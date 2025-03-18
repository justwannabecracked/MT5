const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const listEndPoints = require("list_end_points");
require("dotenv").config();
const { monitorTrades } = require("./mt5Helpers");
const authMiddleware = require("./middleware/auth");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const allowedOrigins = ["https://mt5.onrender.com", "http://localhost:3000"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  email: {
    type: String,
    required: [true, "Enter your Email Address"],
    match: [
      /^(([^<>()[\]\.,;:\s@"]+(\.[^<>()[\]\.,;:\s@"]+)*)|(".+"))@(([^<>()[\]\.,;:\s@"]+\.)+[^<>()[\]\.,;:\s@"]{2,})$/i,
      "Enter a Valid Email Address",
    ],
  },
});

const accountSchema = new mongoose.Schema({
  login: Number,
  password: String,
  server: String,
  created_by: String,
});

const User = mongoose.model("User", userSchema);
const Account = mongoose.model("Account", accountSchema);

app.get("/", (req, res) => {
  res.send({
    message: "Welcome to Mt5 Backend",
    status: "success",
    data: {
      name: "MT5 Backend",
      version: "1.0.0",
    },
  });
});

app.post("/register", async (req, res) => {
  try {
    const { username, password, email } = req.body;
    if (!username || !password || !email)
      return res.status(400).json({
        message: "All fields required",
        status: false,
      });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword, email });
    await newUser.save();

    const payload = {
      user: {
        id: newUser._id,
        email: newUser.email,
      },
    };
    const token = jwt.sign(payload, process.env.SECRET, {
      expiresIn: process.env.LIFETIME,
    });

    res.status(201).json({
      message: "User registered",
      data: newUser,
      token,
      status: "success",
    });
  } catch (error) {
    res.status(500).send("Server error");
    console.log(error);
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).send("All fields required");

    const user = await User.findOne({ email }).exec();
    if (!user)
      return res.status(404).json({
        message: "All fields required",
        status: false,
      });

    const isMatch = bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({
        message: "Invalid Credentials",
        status: false,
      });

    const payload = {
      user: {
        id: user._id,
        email: user.email,
      },
    };
    const token = jwt.sign(payload, process.env.SECRET, {
      expiresIn: process.env.LIFETIME,
    });

    res.json({
      message: "User logged in successfully",
      data: { username: user.username, email: user.email },
      token,
      status: "success",
    });
  } catch (error) {
    res.status(500).send("Server error");
  }
});

app.get("/user", authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ email: req.user.email }).select(
      "-password"
    );
    if (!user) return res.status(404).send("User not found");

    res.json({
      message: "User fetched successfully",
      data: user,
      status: "success",
    });
  } catch (error) {
    res.status(500).send("Server error");
  }
});

app.get("/user-accounts/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).send("User ID required");
    const accounts = await Account.find({ created_by: userId }).exec();
    res.json({
      message: "User accounts fetched successfully",
      data: accounts,
      status: "success",
    });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.post("/start-monitoring/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).send("User ID required");

    const { selectedAccounts } = req.body;
    if (!selectedAccounts || selectedAccounts.length !== 2)
      return res.status(400).send("Two accounts required.");

    const accounts = await Account.find({
      _id: { $in: selectedAccounts },
      created_by: userId,
    });
    if (accounts.length < 2)
      return res.status(400).send("Invalid accounts selection.");

    const data = await monitorTrades(accounts[0], accounts[1]);
    res.json({
      message: "Monitoring started",
      status: "success",
      data: data,
    });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.post("/add-account/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).send("User ID required");

    const { login, password, server } = req.body;
    if (!login || !password || !server)
      return res.status(400).send("All fields required");

    const newAccount = new Account({
      login,
      password,
      server,
      created_by: userId,
    });
    await newAccount.save();
    res.status(201).json({
      message: "Account added",
      data: newAccount,
      status: "success",
    });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// app.post("/close-trade", (req, res) => {
//   const { tradeId } = req.body;
//   if (!tradeId) return res.status(400).send("Trade ID required");

//   const pythonProcess = spawn("python3", ["CopyTrading.py", "close", tradeId]);
//   pythonProcess.stdout.on("data", (data) => console.log(`[Python] ${data}`));
//   pythonProcess.stderr.on("data", (data) =>
//     console.error(`[Python Error] ${data}`)
//   );

//   res.send("Trade close request sent");
// });

listEndPoints.default(app);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

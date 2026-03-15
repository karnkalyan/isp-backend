const axios = require("axios");
const crypto = require("crypto");
const https = require("https");
require('dotenv').config();

const API_BASE = `https://${process.env.YEASTAR_PBX_IP}:${process.env.YEASTAR_PBX_PORT}/api/v2.0.0`;

let tokenCache = null;
let tokenExpiry = 0;

const api = axios.create({
  baseURL: API_BASE,
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  headers: { "Content-Type": "application/json" }
});

const getMd5 = (str) => crypto.createHash("md5").update(str).digest("hex");

async function login() {
  try {
    const payload = {
      username: process.env.YEASTAR_USERNAME,
      password: getMd5(process.env.YEASTAR_PASSWORD),
      version: "2.0.0"
    };

    const res = await api.post("/login", payload);

    if (res.data.status === "Success") {
      tokenCache = res.data.token;
      tokenExpiry = Date.now() + 25 * 60 * 1000; // Refresh before 30 min limit
      return tokenCache;
    }
    throw new Error(`Login Failed: ${res.data.status}`);
  } catch (err) {
    console.error(`[AUTH] Error: ${err.message}`);
    throw err;
  }
}

async function getToken() {
  if (!tokenCache || Date.now() > tokenExpiry) {
    return await login();
  }
  return tokenCache;
}

module.exports = { api, getToken };
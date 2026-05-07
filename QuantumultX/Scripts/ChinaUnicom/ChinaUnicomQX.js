/*
中国联通 Quantumult X 签到 - 第一阶段

功能:
1. 通过 rewrite 捕获联通 App login.htm/onLine.htm 响应中的 token_online / desmobile。
2. 定时任务使用 token_online 调用 onLine.htm 刷新登录态。
3. 执行首页签到、签到状态查询、话费红包查询。
4. 多账号独立执行，日志与通知默认脱敏。

安全边界:
- 不支持账号密码登录。
- 不使用代理。
- 不访问第三方域名。
- 不打印完整 token、cookie、ecs_token 或完整响应体。

配置示例:

[rewrite_local]
^https:\/\/m\.client\.10010\.com\/mobileService\/(login|onLine)\.htm url script-response-body https://raw.githubusercontent.com/WhiteBalance2800K/ruleset/refs/heads/main/QuantumultX/Scripts/ChinaUnicom/ChinaUnicomQX.js

[task_local]
30 8 * * * https://raw.githubusercontent.com/your/repo/main/ChinaUnicomQX.js, tag=中国联通签到, enabled=true

[mitm]
hostname = m.client.10010.com
*/

const $ = new Env("中国联通签到");

const STORE_KEY = "CU_QX_ACCOUNTS";
const DEFAULT_UA = 'Dalvik/2.1.0 (Linux; U; Android 9; ALN-AL10 Build/PQ3A.190705.11211540);unicom{version:android@11.0000}';
const IOS_UA = 'ChinaUnicom4.x/12.2 (com.chinaunicom.mobilebusiness; build:44; iOS 15.8.3) Alamofire/4.7.3 unicom{version:iphone_c@12.0200}';
const ALLOWED_HOSTS = [
  "m.client.10010.com",
  "activity.10010.com",
  "act.10010.com"
];

$.messages = [];

!(async () => {
  if (typeof $request !== "undefined") {
    captureAccount();
    return;
  }

  const accounts = loadAccounts();
  if (!accounts.length) {
    push("未找到账号。请先开启 rewrite 后打开联通 App 登录/刷新首页，或手动写入 CU_QX_ACCOUNTS。");
    return;
  }

  push(`共找到 ${accounts.length} 个账号`);
  for (let i = 0; i < accounts.length; i++) {
    const account = new UnicomAccount(accounts[i], i + 1);
    await account.run();
    if (i < accounts.length - 1) await wait(1200);
  }
})()
  .catch((err) => push(`脚本异常: ${safeError(err)}`))
  .finally(() => {
    const body = $.messages.join("\n");
    if (body) $.msg($.name, "", body);
    $.done(getDoneValue());
  });

class UnicomAccount {
  constructor(raw, index) {
    this.index = index;
    this.token = raw.token_online || raw.token || "";
    this.mobile = raw.mobile || raw.desmobile || "";
    this.ecsToken = "";
    this.cookies = makeCookieStore();
    this.initialTelephone = null;
  }

  label() {
    return `账号[${this.index}]${this.mobile ? "[" + maskPhone(this.mobile) + "]" : ""}`;
  }

  log(message) {
    push(`${this.label()} ${message}`);
  }

  async run() {
    if (!this.token) {
      this.log("缺少 token_online，跳过");
      return;
    }

    const onlineOk = await this.onLine();
    if (!onlineOk) return;

    await this.getTelephone(true);
    await wait(600);
    await this.getContinuous();
    await wait(600);
    await this.getTelephone(false);
  }

  async onLine() {
    const result = await request({
      name: "onLine",
      method: "POST",
      url: "https://m.client.10010.com/mobileService/onLine.htm",
      headers: {
        "User-Agent": DEFAULT_UA,
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": this.cookieFor("https://m.client.10010.com")
      },
      body: formEncode({
        isFirstInstall: "1",
        netWay: "Wifi",
        version: "android@11.0000",
        token_online: this.token,
        provinceChanel: "general",
        deviceModel: "ALN-AL10",
        step: "dingshi",
        androidId: "291a7deb1d716b5a",
        reqtime: Date.now()
      })
    });

    this.updateCookie("https://m.client.10010.com", result.headers);
    const data = result.body || {};
    const code = String(data.code ?? result.statusCode ?? "");
    if (code === "0") {
      this.ecsToken = data.ecs_token || "";
      if (data.desmobile) this.mobile = data.desmobile;
      saveAccount({ token_online: this.token, mobile: this.mobile, updatedAt: Date.now() });
      this.log("登录态刷新成功");
      return true;
    }

    this.log(`登录态刷新失败[${code}]: ${safeText(data.desc || data.msg || "")}`);
    return false;
  }

  async getContinuous() {
    const result = await request({
      name: "sign_getContinuous",
      method: "GET",
      url: withQuery("https://activity.10010.com/sixPalaceGridTurntableLottery/signin/getContinuous", {
        taskId: "",
        channel: "wode",
        imei: ""
      }),
      headers: this.commonHeaders("https://activity.10010.com", "https://img.client.10010.com/")
    });

    this.updateCookie("https://activity.10010.com", result.headers);
    const data = result.body || {};
    const code = String(data.code ?? "");
    if (code !== "0000") {
      this.log(`查询签到状态失败[${code || result.statusCode}]: ${safeText(data.desc || "")}`);
      return;
    }

    const todayIsSignIn = data?.data?.todayIsSignIn || "n";
    if (todayIsSignIn === "n") {
      this.log("今日未签到，开始签到");
      await wait(800);
      await this.daySign();
    } else {
      this.log("今日已签到");
    }
  }

  async daySign() {
    const result = await request({
      name: "sign_daySign",
      method: "POST",
      url: "https://activity.10010.com/sixPalaceGridTurntableLottery/signin/daySign",
      headers: this.commonHeaders("https://activity.10010.com", "https://img.client.10010.com/"),
      body: ""
    });

    this.updateCookie("https://activity.10010.com", result.headers);
    const data = result.body || {};
    const code = String(data.code ?? "");
    if (code === "0000") {
      const detail = data.data || {};
      const parts = ["签到成功"];
      if (detail.statusDesc) parts.push(`[${safeText(detail.statusDesc)}]`);
      if (detail.redSignMessage) parts.push(safeText(detail.redSignMessage));
      this.log(parts.join(" "));
      return;
    }

    if (code === "0002" && String(data.desc || "").includes("已经签到")) {
      this.log("今日已完成签到");
      return;
    }

    this.log(`签到失败[${code || result.statusCode}]: ${safeText(data.desc || "")}`);
  }

  async getTelephone(isInitial) {
    const result = await request({
      name: "sign_getTelephone",
      method: "POST",
      url: "https://act.10010.com/SigninApp/convert/getTelephone",
      headers: this.commonHeaders("https://act.10010.com", "https://img.client.10010.com/"),
      body: ""
    });

    this.updateCookie("https://act.10010.com", result.headers);
    const data = result.body || {};
    const status = String(data.status ?? "");
    if (status !== "0000" || !data.data) {
      this.log(`话费红包查询失败[${status || result.statusCode}]: ${safeText(data.msg || "")}`);
      return;
    }

    const current = parseFloat(data.data.telephone) || 0;
    if (isInitial) {
      this.initialTelephone = current;
      this.log(`话费红包运行前总额 ${current.toFixed(2)}元`);
      return;
    }

    if (this.initialTelephone !== null) {
      const increase = current - this.initialTelephone;
      this.log(`本次运行增加 ${increase.toFixed(2)}元`);
    }

    let message = `话费红包总额 ${current.toFixed(2)}元`;
    if (parseFloat(data.data.needexpNumber) > 0) {
      message += `，${safeText(data.data.needexpNumber)}元将于${safeText(data.data.month)}月底到期`;
    }
    this.log(message);
  }

  cookieFor(url) {
    const host = getHost(url);
    return this.cookies[host] || "";
  }

  updateCookie(url, headers) {
    const host = getHost(url);
    this.cookies[host] = mergeSetCookie(this.cookies[host], headers);
  }

  commonHeaders(url, referer) {
    return {
      "User-Agent": IOS_UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": referer,
      "Cookie": this.cookieFor(url)
    };
  }
}

function captureAccount() {
  if (!$request || $request.method === "OPTIONS") return;

  const url = $request.url || "";
  if (!/^https:\/\/m\.client\.10010\.com\/mobileService\/(login|onLine)\.htm/.test(url)) {
    return;
  }

  const data = parseJson($response && $response.body);
  if (!data || typeof data !== "object") {
    $.msg($.name, "捕获失败", "响应不是 JSON");
    return;
  }

  const token = data.token_online || extractFormValue($request.body, "token_online");
  const mobile = data.desmobile || data.mobile || data.phone || "";
  if (!token) {
    $.msg($.name, "捕获失败", `未找到 token_online，响应码 ${safeText(data.code || data.status || "")}`);
    return;
  }

  const saved = saveAccount({ token_online: token, mobile, updatedAt: Date.now() });
  const title = saved.updated ? "更新账号成功" : "新增账号成功";
  $.msg($.name, title, `${mobile ? maskPhone(mobile) : maskToken(token)}，当前 ${saved.count} 个账号`);
}

function loadAccounts() {
  const raw = getStore(STORE_KEY);
  if (!raw) return [];
  const parsed = parseJson(raw);
  if (Array.isArray(parsed)) return parsed.filter(v => v && (v.token_online || v.token));
  if (parsed && (parsed.token_online || parsed.token)) return [parsed];
  return [];
}

function saveAccount(account) {
  const accounts = loadAccounts();
  const token = account.token_online || account.token;
  const mobile = account.mobile || account.desmobile || "";
  let updated = false;

  const index = accounts.findIndex(item => {
    if (!item) return false;
    if (mobile && (item.mobile === mobile || item.desmobile === mobile)) return true;
    return (item.token_online || item.token) === token;
  });

  const next = {
    token_online: token,
    mobile: mobile || (index >= 0 ? accounts[index].mobile : ""),
    updatedAt: account.updatedAt || Date.now()
  };

  if (index >= 0) {
    accounts[index] = { ...accounts[index], ...next };
    updated = true;
  } else {
    accounts.push(next);
  }

  setStore(STORE_KEY, JSON.stringify(accounts));
  return { updated, count: accounts.length };
}

async function request(options) {
  assertAllowedHost(options.url);

  const req = {
    url: options.url,
    method: options.method || "GET",
    headers: options.headers || {},
    body: options.body,
    timeout: options.timeout || 15000
  };

  try {
    const resp = await $task.fetch(req);
    const body = parseJson(resp.body) ?? resp.body;
    return {
      statusCode: resp.statusCode,
      headers: resp.headers || {},
      body
    };
  } catch (err) {
    throw new Error(`${options.name || "request"} 请求失败: ${safeError(err)}`);
  }
}

function assertAllowedHost(url) {
  const host = getHost(url);
  if (!host || !ALLOWED_HOSTS.includes(host)) {
    throw new Error(`阻止非白名单请求: ${host || "unknown"}`);
  }
}

function getHost(url) {
  return String(url).match(/^https?:\/\/([^/?#]+)/i)?.[1]?.toLowerCase() || "";
}

function makeCookieStore() {
  const cookie = makeBaseCookie();
  return ALLOWED_HOSTS.reduce((store, host) => {
    store[host] = cookie;
    return store;
  }, {});
}

function makeBaseCookie() {
  const tokenId = randomString(32);
  const tokenIdCookie = "chinaunicom-" + randomString(32).toUpperCase();
  return `TOKENID_COOKIE=${tokenIdCookie}; UNICOM_TOKENID=${tokenId}; sdkuuid=${tokenId}`;
}

function mergeSetCookie(cookie, headers) {
  const jar = {};
  String(cookie || "").split(";").forEach(part => {
    const idx = part.indexOf("=");
    if (idx > 0) jar[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  });

  const setCookie = getHeader(headers, "set-cookie");
  const list = Array.isArray(setCookie) ? setCookie : (setCookie ? [setCookie] : []);
  list.forEach(item => {
    String(item).split(/,(?=[^;,]+=)/).forEach(one => {
      const pair = one.split(";")[0];
      const idx = pair.indexOf("=");
      if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    });
  });

  return Object.keys(jar).map(key => `${key}=${jar[key]}`).join("; ");
}

function getHeader(headers, name) {
  if (!headers) return "";
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return "";
}

function withQuery(url, params) {
  const query = Object.keys(params)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key] == null ? "" : params[key])}`)
    .join("&");
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

function formEncode(obj) {
  return Object.keys(obj)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(obj[key] == null ? "" : obj[key])}`)
    .join("&");
}

function extractFormValue(body, key) {
  if (!body) return "";
  const reg = new RegExp(`(?:^|&)${key}=([^&]*)`);
  const match = String(body).match(reg);
  return match ? decodeURIComponent(match[1]) : "";
}

function parseJson(text) {
  if (!text || typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function maskPhone(value) {
  const text = String(value || "");
  if (/^\d{11}$/.test(text)) return text.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2");
  return maskToken(text);
}

function maskToken(value) {
  const text = String(value || "");
  if (text.length <= 8) return text ? "***" : "";
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function safeText(value) {
  return String(value == null ? "" : value)
    .replace(/\d{11}/g, m => maskPhone(m))
    .replace(/([?&](?:token|token_online|ecs_token|access_token)=)[^&\s]+/ig, "$1***")
    .replace(/(Cookie:?\s*)[^\n]+/ig, "$1***")
    .slice(0, 180);
}

function safeError(err) {
  const msg = err && (err.message || err.error || err.toString ? err.toString() : String(err));
  return safeText(msg || "unknown");
}

function randomString(length) {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let text = "";
  for (let i = 0; i < length; i++) text += chars[Math.floor(Math.random() * chars.length)];
  return text;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function push(message) {
  const text = safeText(message).trim();
  if (!text) return;
  $.messages.push(text);
  $.log(text);
}

function getStore(key) {
  return $.getdata(key);
}

function setStore(key, value) {
  return $.setdata(value, key);
}

function getDoneValue() {
  if (typeof $response !== "undefined" && $response && typeof $response.body !== "undefined") {
    return { body: $response.body };
  }
  return {};
}

function Env(name) {
  return new class {
    constructor(name) {
      this.name = name;
      this.logs = [];
      this.startTime = Date.now();
      this.log(`🔔${this.name}, 开始!`);
    }

    isQuanX() {
      return typeof $task !== "undefined";
    }

    getdata(key) {
      if (typeof $prefs !== "undefined") return $prefs.valueForKey(key);
      return null;
    }

    setdata(value, key) {
      if (typeof $prefs !== "undefined") return $prefs.setValueForKey(value, key);
      return false;
    }

    msg(title = name, subtitle = "", body = "") {
      if (typeof $notify !== "undefined") $notify(title, subtitle, body);
      this.log(`${title}${subtitle ? " " + subtitle : ""}${body ? "\n" + body : ""}`);
    }

    log(...logs) {
      if (logs.length) console.log(logs.join("\n"));
    }

    done(value = {}) {
      const cost = ((Date.now() - this.startTime) / 1000).toFixed(2);
      this.log(`🔔${this.name}, 结束! ${cost} 秒`);
      if (typeof $done !== "undefined") $done(value);
    }
  }(name);
}

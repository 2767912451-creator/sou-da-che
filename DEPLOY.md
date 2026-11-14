# 部署指南

## 方案一：Render.com 免费部署（最快，10 分钟上线）

1. **注册 GitHub + Render**
   - 注册 [github.com](https://github.com)，新建仓库
   - 注册 [render.com](https://render.com)（用 GitHub 账号登录）

2. **推送代码到 GitHub**
   ```bash
   cd 搜打撤
   git init && git add -A && git commit -m "搜打撤游戏"
   git remote add origin https://github.com/你的用户名/sou-da-che.git
   git push -u origin main
   ```

3. **Render 上部署**
   - Dashboard → New → Web Service → 连接你的 GitHub 仓库
   - Build Command: `npm install`
   - Start Command: `node server/index.js`
   - 点 Create → 等待构建完成 → 得到地址 `https://xxx.onrender.com`

4. **把地址发给朋友** — 浏览器打开就能玩

> ⚠️ 免费版限制：15 分钟无人访问会休眠（下一个人打开要等 30 秒冷启动）；重新部署时存档清零

---

## 方案二：腾讯云/阿里云轻量服务器（国内玩家延迟最低）

1. **购买**：腾讯云轻量应用服务器 2核2G（新人 ¥30-60/月，常有 ¥99/年 活动）
2. **系统**：选 Ubuntu 22.04
3. **连接服务器**
   ```bash
   ssh root@服务器IP
   ```
4. **装 Node.js**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
   apt install -y nodejs
   ```
5. **上传项目**
   ```bash
   # 在你电脑上执行
   scp -r 搜打撤 root@服务器IP:/opt/
   ```
6. **启动**
   ```bash
   cd /opt/搜打撤
   npm install
   npm install -g pm2
   pm2 start server/index.js --name sou-da-che
   pm2 save && pm2 startup    # 开机自启
   ```
7. **防火墙放行 3000 端口**（在云控制台的防火墙/安全组里添加 TCP 3000）
8. **朋友访问** `http://服务器IP:3000`

---

## 方案三：Oracle Cloud 永久免费 VPS

1. 注册 [oracle.com/cloud/free](https://cloud.oracle.com/free)（需信用卡验证）
2. 创建 AMD Compute 实例（1C1G，永久免费）
3. 后续步骤同方案二

> ⚠️ 注册较麻烦（需要信用卡 + 可能被拒），但性能和稳定性最好

---

## 方案四：内网穿透（临时给朋友试玩）

适合"让朋友先试一下"，你电脑开机才能玩：

```bash
# 安装 cpolar（或 ngrok / npx localtunnel）
npm install -g localtunnel
lt --port 3000
# 得到地址 https://xxx.loca.lt 发给朋友
```

> ⚠️ 电脑关机就断；免费隧道限速；每次重启地址会变

---

## 方案对比

| 方案 | 费用 | 国内延迟 | 稳定性 | 适合 |
|---|---|---|---|---|
| Render.com 免费 | ¥0 | 200-400ms | 中（会休眠） | 朋友试玩 |
| 腾讯云轻量 | ¥30-60/月 | 20-50ms | 高 | 正式联机 |
| Oracle 免费 | ¥0 | 200-300ms | 高 | 折腾党 |
| 内网穿透 | ¥0 | 取决于你的网 | 低 | 快速演示 |

---

## 常见问题

**Q: 需要域名吗？**
A: 不需要。直接用 IP:3000 或平台分配的域名即可。如果要 HTTPS（微信内打开需要），可用 Cloudflare（免费）套一层。

**Q: 存档会丢吗？**
A: Render 免费版重启会丢（data/players.json 是文件存储）。云服务器用 pm2 不会丢。

**Q: 最多能几人同时玩？**
A: 2核2G 轻量服务器实测可跑 3-4 个房间 × 16 人。Render 免费版 1-2 个房间够用。

**Q: 想要 HTTPS？**
A: Render 自动提供。云服务器可用 Caddy 反代（一行配置自动 HTTPS）。


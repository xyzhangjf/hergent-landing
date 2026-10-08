# her-agent.com 证书与站点诊断报告

- **诊断时间**：2026 年 9 月 25 日 10:28 – 10:40（中国标准时间）
- **诊断对象**：生产服务器 `root@47.113.224.140` 上的 `her-agent.com` 站点与证书
- **触发来源**：2026-09-25 每日只读巡检中发现的「非巡检范围」线索，经用户确认后另开一次专项检查
- **纪律**：**全程只读**。未修改/删除/重命名生产任何文件与配置，未部署、未重启任何服务，未写业务库。本轮**未执行任何修复**。

---

## 一、结论（先看这里）

**这不是"证书坏了需要修"，而是"一个已经彻底不用的站点还在每天做无意义的续期、每天失败"。**

| 问题 | 判定 |
|---|---|
| 证书续期连续失败 | ✅ 已定位根因（三重错位，见第四节） |
| 证书已过期 26 天 | ✅ 事实确认（8 月 30 日到期） |
| **对线上业务的影响** | **无** —— 公网访问 `her-agent.com` 走 Cloudflare，**根本不经过这台服务器** |
| 真正该做的动作 | **不是续期，而是清理**（见第六节方案 A） |
| 附带发现的安全问题 | 🔴 **一把阿里云密钥同时握有「对象存储写」+「域名解析写」两种权限，且密钥标识已明文落在可被普通用户读取的日志里** |

---

## 二、事实清单（每条附实测原始输出）

### 2.1 证书确实已过期

```text
$ certbot certificates
  Certificate Name: api.hergent.cn
    Identifiers: api.hergent.cn erp.hergent.cn hergent.cn
    Expiry Date: 2026-11-09 12:05:42+00:00 (VALID: 45 days)

  Certificate Name: her-agent.com
    Identifiers: her-agent.com www.her-agent.com
    Expiry Date: 2026-08-30 06:58:26+00:00 (INVALID: EXPIRED)     ← 已过期 26 天
    Key Type: ECDSA
```

证书下唯一一次签发是 6 月 1 日，归档目录只有一套文件、此后**再无成功签发**：

```text
$ ls -lt /etc/letsencrypt/archive/her-agent.com/
-rw-r--r-- 1 root root 1314 Jun  1 15:56 cert1.pem
-rw-r--r-- 1 root root 3523 Jun  1 15:56 chain1.pem
-rw-r--r-- 1 root root 4837 Jun  1 15:56 fullchain1.pem
-rw------- 1 root root  241 Jun  1 15:56 privkey1.pem
```

### 2.2 续期每天都在失败，失败原因写得很明确

```text
$ journalctl -u certbot.service --since "3 days ago" | tail
Sep 23 00:31:17  All renewals failed. The following certificates could not be renewed:
Sep 23 00:31:17    /etc/letsencrypt/live/her-agent.com/fullchain.pem (failure)
Sep 23 18:31:15  Failed to renew certificate her-agent.com with error: Some challenges have failed.
Sep 24 03:54:43  Failed to renew certificate her-agent.com with error: Some challenges have failed.
Sep 24 18:53:48  Failed to renew certificate her-agent.com with error: Some challenges have failed.
```

详细原因（Let's Encrypt 服务端的原始答复）：

```text
$ grep "her-agent" /var/log/letsencrypt/letsencrypt.log | tail
  Identifier: her-agent.com
  Detail: DNS problem: NXDOMAIN looking up TXT for _acme-challenge.her-agent.com
          - check that a DNS record exists for this domain
  Identifier: www.her-agent.com
  Detail: DNS problem: NXDOMAIN looking up TXT for _acme-challenge.www.her-agent.com
```

**注意**：验证插件那边其实是"成功"的 —— 它的每一次写入都返回了 200：

```text
https://alidns.aliyuncs.com/...Action=DescribeDomains&KeyWord=her-agent.com... " 200 559
https://alidns.aliyuncs.com/...Action=DeleteDomainRecord&DomainName=her-agent.com&RecordId=2103075266691429376... " 200 85
```

**写在阿里云，验证查的是 Cloudflare —— 两边根本不是同一个 DNS 权威，所以永远验不过。**

### 2.3 域名权威服务器早已迁到 Cloudflare

```text
$ dig +short NS her-agent.com
alla.ns.cloudflare.com.
darl.ns.cloudflare.com.

$ dig +short NS her-agent.com @ns1.alidns.com          # 阿里云侧自己的回答
dns30.hichina.com.
dns29.hichina.com.
```

在 Cloudflare 权威上查验证记录 —— 空的（因为记录被写到了阿里云那边）：

```text
$ dig +short TXT _acme-challenge.her-agent.com @alla.ns.cloudflare.com
(空)
```

### 2.4 公网上的 her-agent.com **不是**这台服务器在服务

绕开 Cloudflare 直连源站，拿到的是那张过期证书（说明源站这个虚拟主机确实存在）：

```text
$ openssl s_client -connect 47.113.224.140:443 -servername her-agent.com
depth=0 CN=her-agent.com
verify error:num=10:certificate has expired
notAfter=Aug 30 06:58:26 2026 GMT
```

但**内容指纹对不上**，这是决定性判据：

| 来源 | 页面标题 | 字节数 |
|---|---|---|
| 公网（经 Cloudflare） | `Hergen Technologies — AI-Powered Productivity`（英文站） | **9801** |
| 这台服务器 `/var/www/her-agent.com/index.html` | `Hergent · 装在电脑里的 AI 员工，不是只会聊天`（中文站） | **45888** |

公网响应头显示 `cf-cache-status: DYNAMIC`（即不缓存、每次回源），而内容与源站完全不同 ⇒ **Cloudflare 的回源目标不是这台服务器**。

### 2.5 外网直连这台服务器的 443，被网络层阻断

同一台服务器、同一个端口，两个域名的对比结果：

| 测试位置 | `hergent.cn` | `her-agent.com` |
|---|---|---|
| **源站本机**（`127.0.0.1:443`） | 200 | **200**（证书过期但连接正常建立） |
| **外网直连**（`47.113.224.140:443`） | 200（3/3 稳定） | **000（9 次尝试 8 次失败）** |

外网的失败形态是 TLS 握手阶段被复位：

```text
$ curl -v -k --resolve her-agent.com:443:47.113.224.140 https://her-agent.com
* Connected to her-agent.com (47.113.224.140) port 443
* (304) (OUT), TLS handshake, Client hello (1):
* Recv failure: Connection reset by peer
curl: (35) Recv failure: Connection reset by peer
```

**源站自己访问自己是 200，外网访问同一端口却被复位** —— 这是典型的**网络层拦截**特征，而不是 nginx 配置问题。`hergent.cn` 同机同端口 3/3 正常，排除了"整机被封"或"nginx 故障"。

> 诚实标注：外网 9 次尝试中有 **1 次**握手成功（拿到了那张过期证书）。这说明该拦截**并非 100% 确定性**，具体拦截实现（抽样放行 / 复位注入 / 生效延迟）本轮**未查明**，不做臆断。但 8/9 的失败率已足以支撑"外网实际不可用"的结论。

### 2.6 这台服务器上的站点是"孤岛"，完全没有流量

nginx 的访问日志**不含域名**（无自定义 `log_format`），所以最初想用"日志里搜域名"来判断的思路是**作废探针**，已弃用。改用两条可靠判据：

1. 内容指纹不同（见 2.4）⇒ Cloudflare 不回源这台机器；
2. 外网直连被阻断（见 2.5）⇒ 即便有人直接指向这台 IP 也拿不到内容。

⇒ **该站点当前无任何实际访问来源。**

### 2.7 站点还带着一张 6 月的中文落地页

```text
$ ls -l /var/www/her-agent.com/
-rw-r--r-- 1 root root 45888 Jun  8 08:12 index.html
```

页面内 6 处链接指向 `hergent.cn` —— 说明它当初的角色是「用 `her-agent.com` 给 `hergent.cn` 做推广落地页」，后被 Cloudflare 上的英文站取代。

---

## 三、时间线还原

| 时间 | 事件 |
|---|---|
| 2026-06-01 | 首次也是唯一一次成功签发 `her-agent.com` 证书（有效期至 8 月 30 日） |
| 2026-06-08 | 中文落地页 `index.html` 放上这台服务器 |
| （期间某时） | 域名 NS 从阿里云（hichina）改为 Cloudflare 托管，公网改由 Cloudflare 服务，服务器上站点失去流量 |
| 2026-08-30 | 证书到期 |
| 2026-08-30 起至今 | 续期每次失败（写阿里云、验 Cloudflare），**静默持续 26 天**，仅体现为 `journalctl` 里每天一条 `Failed to start Certbot` |

---

## 四、根因（三重错位叠加）

| # | 错位 | 后果 |
|---|---|---|
| 1 | **续期验证插件指向阿里云 DNS，但域名权威已经迁到 Cloudflare** | 验证记录写在无人查询的地方 ⇒ 必然 `NXDOMAIN` |
| 2 | **公网已改由 Cloudflare 服务，源站站点被弃用** | 没人发现续期失败 —— 因为**没有任何访客会踩到这张过期证书** |
| 3 | **外网对这台服务器的 `her-agent.com` 直连被网络层阻断** | 源站本机访问 200 正常 ⇒ 从服务器内部看"一切正常"，问题在外面看不见 |

> 三条叠加的结果：一个**每天失败但完全无害**的任务，在监控里持续刷失败行，却没有一个真实用户受影响。

---

## 五、附带发现（安全，需单独处理）

### 5.1 一把密钥同时握住两种权限

```text
$ sed -n 's/=.*//p' /etc/letsencrypt/aliyun.ini
dns_aliyun_access_key
dns_aliyun_access_key_secret

$ grep -rl "LTAI5t" /opt/hergent-erp /root /etc
/opt/hergent-erp/.env                       ← 同一把密钥
/etc/letsencrypt/aliyun.ini
```

同一把阿里云密钥标识（`LTAI5t6Vbw…`，此处已脱敏）同时用于：

- **certbot 的域名解析写入**（能增删 `her-agent.com` 的 DNS 记录 —— 日志已证实 `DeleteDomainRecord` 返回 200）
- **`/opt/hergent-erp/.env`**（即异地备份那套对象存储凭证）

⇒ **一旦泄露，攻击者可改域名解析** ⇒ 可为自己签发该域名的合法证书 ⇒ 中间人。这比"只是备份被人写坏"严重一个量级。

### 5.2 密钥标识明文落在 644 权限的日志里

```text
$ grep -rl "AccessKeyId=LTAI" /var/log/letsencrypt/
/var/log/letsencrypt/letsencrypt.log

$ stat -c "%a %U:%G %s %n" /var/log/letsencrypt/letsencrypt.log
644 root:root 376570 /var/log/letsencrypt/letsencrypt.log
```

- 权限 **644** ⇒ 本机**任何用户**都能读（不只是 root）。
- 泄露的是**密钥标识**（AccessKeyId），**不是密钥本体**（Secret），危害等级因此降一档；但配合 5.1 的权限叠加，仍应在轮换清单上。
- 这是 `dns-aliyun` 插件以 DEBUG 级别记录请求所致 —— 属于插件行为，`/etc/letsencrypt/cli.ini` 里没有显式开启。

### 5.3 阿里云侧仍托管着一个已经不用来解析的域名

插件能成功对 `her-agent.com` 执行增删记录 ⇒ 该域名**仍在阿里云账号名下**（注册商在阿里云、NS 已指向 Cloudflare）。阿里云 DNS 里那些记录**不在权威链上**，是残留。

---

## 六、处置方案（本轮均未执行，等确认）

### 方案 A —— 清理孤岛（推荐）

适用于「`her-agent.com` 继续由 Cloudflare 服务，不再指回这台服务器」（**当前事实就是这样**）。

| 步骤 | 动作 | 风险 |
|---|---|---|
| A1 | 移除软链 `/etc/nginx/sites-enabled/her-agent`（保留 `sites-available` 原文与备份） | 极低。该站点公网无人访问 |
| A2 | `nginx -t` 通过后 `systemctl reload nginx` | 极低。reload 不中断现有连接 |
| A3 | 让 `her-agent.com` 停止续期：从 certbot 的续期清单中移出该证书（重命名 `/etc/letsencrypt/renewal/her-agent.com.conf` 即可，证书目录保留） | 低。消除每天一条失败噪音 |
| A4 | 归档 `/var/www/her-agent.com/index.html`（留档，不删） | 低 |
| A5 | 顺带：关闭该域名的外网 443 暴露面（备案/拦截已是既成事实，无需额外动作） | — |

**收益**：`journalctl -u certbot.service` 不再每天刷失败行（我已核对，这会污染每日巡检的"24 小时错误"计数）；服务器少一个持有过期证书的虚拟主机。

### 方案 B —— 让域名重新指回这台服务器

适用于「还想用 `her-agent.com` 指向这台机器」。

1. 把 certbot 验证插件从 `dns-aliyun` 换成 **Cloudflare DNS**（改用 API 令牌），因为权威已在 Cloudflare；
2. 或改用 HTTP 验证（需在 Cloudflare 侧对该域名关闭代理、并确保 80 端口可达）；
3. ⚠️ **前置条件**：需先解决**外网 443 被阻断**的问题（2.5 节）—— 否则即使证书签发成功，公网依然访问不了。**这一步我无法从服务器内部解决**，需要看域名备案状态与云厂商的拦截策略。

> 方案 B 的成本明显高于 A，而两者的实际用户体验差异取决于你是否还需要这个域名指向源站。

### 方案 C —— 暂不处置

只把本条列入每日巡检的「需人工确认」清单持续观察，不动生产。

**推荐：方案 A** —— 因为公网流量已由 Cloudflare 承担、源站站点无访客、而失败噪音每天都在。

### 附加建议（与上表独立，建议尽快）

| # | 事项 | 说明 |
|---|---|---|
| S1 | **确认该阿里云密钥的用途边界**，最好拆成两把：一把只管对象存储、一把只管域名解析 | 降低 5.1 的权限叠加风险 |
| S2 | **轮换该密钥**（若判断有暴露风险） | 与仓库里既有的密钥轮换建议一并处理 |
| S3 | 清理 `/var/log/letsencrypt/letsencrypt.log` 中的明文标识，并收紧该日志权限到 `600` | 需人工确认后再做 |
| S4 | 确认阿里云 DNS 里 `her-agent.com` 的残留托管是否需要保留 | 无解析作用，但删与不删涉及域名业务，不擅自决定 |

---

## 七、本轮明确未做的事

- 未修改/删除/重命名生产任何文件与配置
- 未部署、未重载、未重启任何服务（未执行 `nginx -t` 之外的任何 nginx 操作）
- 未写生产数据库
- 未对阿里云 DNS 执行任何写操作（仅有 certbot 自身历史日志中已存在的记录痕迹被读取）
- 未清理、未归档任何文件

---

## 八、需要你回答一个问题

**`her-agent.com` 这个域名，后续还要指向这台服务器吗？**

- **不需要**（我判断这是当前事实）⇒ 我按**方案 A** 执行清理，约 3 步，全程可回滚。
- **需要** ⇒ 我会先做方案 B 的第 3 步可行性核查（外网阻断能否解除），再决定要不要动续期配置。

---

## 九、清理实施记录（v270）

- **用户决策**：2026-09-25 10:35 回复「A」⇒ 执行方案 A（清理孤岛）。本任务为**用户显式授权**的生产配置清理，与巡检的「只读红线」不冲突。
- **执行时间**：2026-09-25 10:36:07 起
- **编号**：**v270**。三连搜实录（本地两仓 + 生产 + 当日记忆，全部为空）：

  ```text
  $ grep -rn -o -e "v270" -e "V270" hergent-cn-v2/src hergent-admin/src   # 空 ⇒ 未占用
  $ grep -rn -o -e "v270" -e "V270" 后端仓/server 后端仓/*.py              # 空 ⇒ 未占用
  $ grep -rl -e "v270" -e "V270" /opt/hergent-erp /opt/hergent-cn-v2 /etc/nginx   # 空 ⇒ 未占用
  $ grep -c "v270" .workbuddy/memory/2026-09-25.md …                      # 0
  ```

### 9.1 改前基线（用于回滚与校验）

| 项目 | 改前值 |
|---|---|
| 站点软链 | `/etc/nginx/sites-enabled/her-agent -> /etc/nginx/sites-available/her-agent` |
| 站点配置 md5 | `2194949d2f833c84fe82c47edda812cd` |
| 续期配置 md5 | `c299d04ecaf689d0e4d803e1f1885f54` |
| 站点内容 md5 | `f091a50aa26ca5ededc2e386ca85f371`（45888 字节） |
| nginx 配置中该站点出现次数 | `server_name her-agent.com` 共 **2** 处（80 与 443 两个 server 块） |

### 9.2 改动内容（6 步，逐条已回显）

| # | 动作 | 结果 |
|---|---|---|
| 1 | 归档备份全部改动对象为单个压缩包 | `/opt/hergent-erp/backups/pre-v270-her-agent-site-20260925-103607.tar.gz`（12560 字节，md5 `6c867d9618e10804afa39a54f90618c2`）。内含 5 个条目：`sites-available/her-agent`、`sites-enabled/her-agent`（软链）、`renewal/her-agent.com.conf`、`var/www/her-agent.com/`、其 `index.html` |
| 2 | 移除站点软链 `rm -f /etc/nginx/sites-enabled/her-agent` | `sites-enabled` 只剩 `api-proxy`、`hergent`、`hergent-erp`。**`sites-available` 原文完整保留**（未删） |
| 3 | `nginx -t` | `syntax is ok` / `test is successful`。唯一警告 `"ssl_stapling" ignored … api.hergent.cn` 是**既有的**（改动前就存在，且与本次无关） |
| 4 | `systemctl reload nginx` | `rc=0`，nginx `active`。**仅 reload，未重启** —— 主进程 PID 仍为 `2235106`、`ActiveEnterTimestamp` 仍为 9 月 15 日 |
| 5 | `mv renewal/her-agent.com.conf → .conf.disabled` | `renewal` 目录 `.conf` 只剩 `api.hergent.cn.conf`（certbot 只认 `*.conf`，故被忽略） |
| 6 | `mv /var/www/her-agent.com → /var/www/her-agent.com.retired-20260925` | 内容原地留档、可逆 |

### 9.3 五段验收（全部真机实测）

**① 主业务健康 —— 未受任何影响**

```text
内网健康: 200    外网健康: 200    erp外网: 200
服务 hergent-erp: active        nginx: active
```

**② 那张过期证书已不再被提供**（关键）

```text
$ openssl s_client -connect 127.0.0.1:443 -servername her-agent.com
CONNECTED(00000003)
subject=CN = api.hergent.cn
  ↑ 改动前此处为 subject=CN = her-agent.com（8 月 30 日过期那张）
```

⇒ 现在无匹配站点，请求落到默认站点，返回的是**有效期内的** `api.hergent.cn` 证书；**不再对外提供那张过期证书**。

**③ certbot 已不认识该证书**（续期不再尝试）

```text
$ certbot renew --dry-run --cert-name her-agent.com
No certificate found with name her-agent.com (expected /etc/letsencrypt/renewal/her-agent.com.conf).
```

**④ 备份真实可恢复**（解包后与改前基线逐字一致，临时目录已清理）

```text
f091a50aa26ca5ededc2e386ca85f371  …/var/www/her-agent.com/index.html
2194949d2f833c84fe82c47edda812cd  …/etc/nginx/sites-available/her-agent
c299d04ecaf689d0e4d803e1f1885f54  …/etc/letsencrypt/renewal/her-agent.com.conf
临时目录是否已清理: 已清理
```

**⑤ 回归检查 —— 默认站点与三个业务域名均正常**

```text
不带 SNI 的 443:  subject=CN = api.hergent.cn   curl 200
源站自测:  hergent.cn -> 200    erp.hergent.cn -> 200    api.hergent.cn -> 200
nginx 主进程 PID: 2235106（未变）  NRestarts=0
```

### 9.4 该改动的天然验证点

certbot 定时器下次触发为 **2026-09-25 11:03:44**。改动前的 24 小时内仍有 **1** 条历史失败行（累积），此后应**不再新增**。

下次巡检请确认：

```bash
journalctl -u certbot.service --since "24 hours ago" --no-pager | grep -c "Failed to renew certificate her-agent"
# 期望 0
```

### 9.5 回滚方法（如需）

```bash
tar xzf /opt/hergent-erp/backups/pre-v270-her-agent-site-20260925-103607.tar.gz -C /
ln -sf /etc/nginx/sites-available/her-agent /etc/nginx/sites-enabled/her-agent
mv /etc/letsencrypt/renewal/her-agent.com.conf.disabled /etc/letsencrypt/renewal/her-agent.com.conf
mv /var/www/her-agent.com.retired-20260925 /var/www/her-agent.com
nginx -t && systemctl reload nginx
```

### 9.6 本轮明确未做的事

- 未删除任何文件（软链是移除、配置与内容均改名或原位保留，全部有压缩包留档）
- 未重启任何服务（nginx 仅 reload，`hergent-erp` 全程未动）
- 未写业务库
- 未处理第六节「附加建议 S1–S4」（拆分/轮换那把阿里云密钥、收紧日志权限、清理阿里云 DNS 残留托管）—— 这些涉及凭据与域名业务，**等你单独确认**

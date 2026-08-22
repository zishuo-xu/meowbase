# 平台只在允许的目录里干活，也只听本机说话

一篇只写**一个**可验收的特性。写完就做这一刀，做完再开下一篇。

- 状态:`已落地`
- 对照 clowder:绑仓那道门是 **F074** 的 roots 白名单——选项目路径时过 `validateProjectPath`,不在 roots 里回 403;未配置时默认放行 `$HOME` + `/tmp` + `/private/tmp`(F074 又加 `/Volumes`),**不是默认全禁**;显式配置是**覆盖**不是追加,理由是已经有人靠 env 收紧过,升级不许悄悄放宽;拒因回结构化 `{ error, selectedPath, allowedRoots }`,并且**不要把用户选的路径写成 canonical realpath**。另一条面 **F063**(Hub 读写仓库文件)才做 `resolve` → `realpath` → `startsWith(realRoot + sep)`、跨根 symlink 拒、敏感文件 denylist。LAN 那一侧他们在 SETUP 里写:`API_SERVER_HOST=0.0.0.0` 时特权写必须有 `DEFAULT_OWNER_USER_ID`,否则 403。
- 靠拢:门的**位置**和**默认值**照 F074 抄——安在绑仓入口,默认放行家目录和临时目录而不是默认全禁,配了就是覆盖,拒因带上「你选了什么 + 现在允许哪些根」。路径**判法**不照 F074(它公开文档没写 `..` / symlink 怎么判),改靠 F063 的 realpath + `sep` 边界:因为我们这道门后面站的是 `bypassPermissions` 的 agent CLI,比他们那道「选目录」严重。LAN 那侧本刀比他们**更保守**:他们默认支持 `0.0.0.0` 再拿 owner 闸挡特权写,我们单机自用,直接默认只绑 `127.0.0.1`,想开 LAN 得显式配——因为喵窝整个 API 没有身份概念,做不出 owner 闸。

## 门（各一句）

- **功能**：绑仓只能绑在允许的根下面;API 默认只听本机,不听同网段和浏览器里随便一个网页
- **价值**：人不用担心「开着 3200 去咖啡厅」等于把整台机器交出去;绑错路径当场看见允许范围,不用猜
- **愿景**：仍是邮差。平台不猜哪个目录该给,只执行人配好的范围,拒的时候说清拒因
- **落点**：`http/server.ts` 建线程入口 + `index.ts` 的 host + shared 一个纯函数判路径。不新开第二心脏

## 为什么

**现在这条路是走得通的,不是洁癖问题。** 三件事叠在一起:

1. 生产入口 `host: '0.0.0.0'`(`packages/api/src/index.ts`)——同网段任何人都能连 3200
2. `app.register(cors, { origin: true })`(`http/server.ts`)——反射任意来源,所以**你浏览器里打开的任何网页**都能跨域 POST 过来(JSON 预检照过)
3. `POST /api/threads` 对 `repoPath` 只校验「存在 + 是 git 仓 + 分支在」,没有根白名单;整个 API 没有任何鉴权(`apiKey` 那些是模型供应商密钥,不是接口鉴权)

连起来:一个没有身份的调用方可以建一个绑到本机**任意** git 仓的线程,然后派任务给以 `bypassPermissions` 跑的 agent CLI 在那个仓的 worktree 里干活。等于任意文件写 + 任意命令执行,还花人的 token。

有一件事已经做对了,别顺手改坏:`GET /api/config` 走 `publicConfig()`,`publicModelPreset` 把 `apiKey` 剥掉换成 `hasApiKey: true`,模型密钥没有从这个口子出去。

对齐他们哪一条:F074 就是这道门,而且他们自己写了动机是「零认证裸跑」;F077(每人一张 `allowedProjectPaths[]`、Thread ACL、共享区审批)是从 F074 长出来的,但那是**多用户 spec、还没做成**,我们单机自用不搬。

## 怎么做

1. **默认只听本机**。`index.ts` 的 host 从 `'0.0.0.0'` 改成 `'127.0.0.1'`,留一个显式开关(env)给想从手机看 Hub 的人。`startApp` 已经收 `host` 参数,e2e / smoke 各自传,不受影响。

2. **CORS 不再反射任意来源**。只放行本机 web 那个来源(默认 3300,跟着配置里的端口走),其余拒。注意 `http://localhost:3300` 和 `http://127.0.0.1:3300` 是**两个不同的 origin 字符串**,都要放行,否则人换一种写法打开页面就全 400。

   Next 开发服务器也会绑 LAN(启动日志里那行 `Network: http://…:3300`),但**那不是同一个洞**:前端 `baseUrl` 默认 `http://localhost:3200` 且是 `NEXT_PUBLIC_*` 编译进包的,LAN 访问者拿到的页面只会去打**他自己机器**的 3200。真正的洞是 API 在 `0.0.0.0`,直接打 `<host>:3200` 就行,不用绕 web。所以本刀只管 API 那一侧;顺带一句实现细节:来源表要从 web 的实际来源推,有人把 `NEXT_PUBLIC_API_URL` 指到 LAN 地址时那份表也得带上他那个来源,否则改完 CORS 他的页面全 400。

3. **WebSocket 也要看 Origin**。浏览器对 WS **不走 CORS**,只带 `Origin` 头、不强制。光改 CORS 会在旁边留个洞:一个恶意页面照样能连上 `/ws` 读线程流。升级时按同一张来源表判,不合就拒。

4. **判路径做成 shared 纯函数**。输入「人填的路径 + 允许的根列表」,输出放行或拒。判法:`resolve` → `realpath`(两边都取)→ 比 `realRoot + sep` 前缀,同时保留**人原来填的那个字符串**用于回话。`..` 和 symlink 靠 realpath 自然吃掉;根本身也算放行。

5. **默认根 = 家目录 + 临时目录**,不是默认全禁(照 F074)。配了就是**覆盖**。注意 `os.tmpdir()` 在 macOS 上是 `/var/folders/...` 而 realpath 到 `/private/var/folders/...`,默认根要取 realpath 后的值——否则**记分板那两行绑仓场景会当场红**(`makeScratchRepo` 建的临时仓就在那儿)。

6. **拒因照 F074 的形状**回 403 `{ error, selectedPath, allowedRoots }`。`selectedPath` 是人填的原话,不是 realpath 之后的路径。前端把允许的根显示出来,别只说一句「不允许」。

验收:

- 侧栏填一个家目录外面的 git 仓(比如 `/tmp` 外、`$HOME` 外的路径)→ 403,提示里能看见当前允许哪些根
- 填 `$HOME/..../` 绕一圈指回家目录里 → 放行(realpath 之后在根里)
- 用 symlink 从允许的根指到外面 → 拒
- 配了自定义根之后,家目录**不再**默认放行(覆盖不是追加)
- 默认启动 `lsof -i :3200` 只看到 `127.0.0.1`,不是 `*:3200`
- 从另一个来源跨域 POST `/api/threads` → 被 CORS 拒
- `pnpm test` / `pnpm e2e` / `pnpm eval` 全绿——特别是记分板那两行绑仓场景仍是 3/3

## 不做（本篇）

- **不裁 git 子进程的 env**。原打算对齐 `hold-command` 那套,查完不做:`hold-command` 要裁是因为**命令来自猫的回复**,猫能写 `等跑 env` 把密钥读走;`git.ts` 的 argv 全由平台拼,猫选不了,git 也不回显自己的 env,没有暴露面。裁了反而会坏——git 靠 `HOME` 找 `.gitconfig` 和 credential helper,`SSH_AUTH_SOCK` 也在,正是下一刀放开 push 要用的。他们公开的 LL-019 / LL-020 就是这条:试过换 `HOME` 隔离 CLI 凭据,401、掉 session、MCP 残缺,补了几轮**回退了**。把针对性缓解搬到没有该威胁的地方,只换来假安全感。
- **不做鉴权 / 多用户**。不搬 F077 的 `allowedProjectPaths[]` per user、Thread ACL、owner 闸。喵窝没有身份概念,加了就是新的一颗心脏。默认只听本机是这一刀能给的最薄答案。
- **不做敏感文件 denylist、不做平台代读仓库文件**。那是 F063 那条面(Hub workspace explorer),我们还没有那个功能。只借它的路径判法。
- **不放开猫 push**。仍是下一刀。

## 入口

- 路径判断 / 默认根 / 覆盖:`packages/shared/src/repo-path.ts`(`isRepoPathAllowed` / `defaultAllowedRepoRoots` / `parseAllowedRepoRoots` / `resolveAllowedRepoRoots`)。默认根取 **realpath 之后**的家目录和 `os.tmpdir()`——macOS 上字面 `/var/folders/...` 对不上 `/private/var/folders/...`,eval 那两行绑仓会当场红
- 监听地址 / 来源表 /「不带 Origin 放行」:`packages/shared/src/listen-origin.ts`(`resolveListenHost` / `resolveAllowedOrigins` / `isAllowedRequestOrigin`)。不带 `Origin` 放行(curl / e2e / smoke);带了但不在表里拒。之所以敢放行「不带」:浏览器发跨域请求(含 WS 升级)**一定**会带 `Origin`,恶意页面伪造不出「不带」这种状态;而 curl / Node fetch 这些非浏览器客户端本来就不带,一律拒会把整机自检和人手 curl 全弄挂
- 生产入口默认 `127.0.0.1`:`packages/api/src/index.ts` 调 `resolveListenHost`。`API_SERVER_HOST=0.0.0.0` 开 LAN。`startApp` 仍收 `host`,e2e / smoke 各自传,不复制第二份接线
- 绑仓闸 + CORS + WS 同一张来源表:`packages/api/src/http/server.ts` `buildServer`。`POST /api/threads` 在存在性校验前过 `isRepoPathAllowed`,403 `{ error, selectedPath, allowedRoots }`,`selectedPath` 是人填的原话。`onRequest` 按来源表判 `Origin`(HTTP 和 WS 升级都走这里)
- `startApp` 把 `ALLOWED_REPO_ROOTS` / 来源表推进 `buildServer`:`packages/api/src/app.ts`
- 前端把允许的根拼进报错:`packages/web/lib/api.ts` `request`

/* ESM 解析垫片的注册入口（与 `_esm-ext-resolver.mjs` 配套）。
   用法：
     node --import ./.workbuddy/tools/_esm-register.mjs <探针.mjs>
   🔴 单独一个文件是因为 `--import 'data:text/...'` 内联写法在本机 node 22.22 下
      解析相对路径会报 `ERR_UNSUPPORTED_RESOLVE_REQUEST`（data: 不是分层 scheme）。 */
import { register } from 'node:module'
register('./_esm-ext-resolver.mjs', import.meta.url)

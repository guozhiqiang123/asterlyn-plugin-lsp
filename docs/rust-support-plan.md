# Rust provider 计划

- 日期：2026-10-26；状态：**仅规划，未实现**。
- 插件仓库基线：`bbaacf9`，当前版本 0.1.0。
- 继续使用 `dev.asterlyn.lsp` 与当前仓库，不新建 Rust 插件仓库。
- 主计划在同级宿主仓库：`asterlyn/docs/engineering/2026-10-26-rust-language-services-plan.md`。
  宿主 ADR-0034 仍只接受 TypeScript profile；Rust 需在 R0 冻结增量契约后才能实现。
- 本次不改 manifest、runtime、SDK/vendor、锁文件、服务器资源、版本号或打包产物；不发布远端。

## 1. 插件与宿主分工

插件新增 Rust 的 `language-service` 声明：语言 `rust`、扩展 `.rs`，项目证据以 Cargo manifest 为主。
使用现有有界 host evidence 匹配虚拟 workspace、成员 crate、混合 TS/Rust 项目及 worktree；
缺失/截断证据不能靠插件自己读取文件补全。无 Cargo 的独立文件先明确不完整支持。

rust-analyzer 的发现、校验、工具链选择、Cargo 模型/策略、执行授权、进程、诊断、只读依赖源码
和 UI 全归宿主。Rust 不依赖 Node；同一插件中的 Rust/TS descriptor 不能共享错误的进程或授权 key。
插件无 fs/process/shell/network/DOM/Tauri 权限，不通过 tool/task callback 代跑 rust-analyzer。

首版建议宿主解析已安装的 Rustup rust-analyzer/rust-src 组件，插件不携带多平台原生 server。
需要的 profile/resource 声明由 R0 冻结，只表达宿主认识的 profile，不能包含任意二进制路径、
argv、env 或初始化配置。工具缺失由宿主提示，运行时不下载安装组件或 Cargo 依赖。

## 2. 契约与兼容

1. 和宿主一起冻结 `rust-analyzer` profile、语言/扩展/项目匹配、原生 package/review 绑定、
   工具链/策略身份以及缺工具/部分可用状态。新增 SDK minor 暂拟 1.12.0，不能先手改旧 SDK union。
2. 新包的最低宿主版本必须是实际支持 Rust 契约的版本，不能仍声明最低 0.1.13。
   老宿主应在安装兼容校验阶段拒绝不支持的包，不能激活后再因 Rust kind/profile 被误隔离。
3. 既有 TS/JS 0.1.0 包仍须通过新宿主；纯 TS 项目没有 Rustup/rust-analyzer 也应正常工作。
4. SDK 使用宿主正式生成的精确 tgz，更新 vendor SHA-256/SHA-512、依赖与 lock 一致性；开发快照
   标注未发布，禁止 sibling source import、软链接或直接借用宿主源码。
5. 保持 schema/SDK/runtime 兼容边界显式；只有契约/原生检查/运行时投影均支持后才贡献 Rust。
   新版本具体编号在实施阶段确定，本计划不提前 bump。

## 3. 分步实施与本仓库提交

| 阶段 | 插件责任 | 宿主前置/验收 |
| --- | --- | --- |
| RP0 文档与契约 | 提交本计划，冻结声明/资源布局和 SDK 依赖 | 宿主 R0：信任边界、工具链、真实能力与启动探针 |
| RP1 双语言声明 | Rust descriptor、TS/JS 回归、Cargo 匹配、名称/说明/中英本地化；能力级处置，不因缺 Rust 工具隐藏 TS | 宿主 R1 的多 profile/session/consent/校验全链路；不得启动一个服务就终止另一个 |
| RP2 可验证包 | 生成锁定、可重复、完整 integrity 的新包；只包含合同允许的资源 | 原生 inspector → isolated helper → 桌面结果校验 → registry → Rust 缓冲区 → Rust 执行 review；旧包/旧宿主边界 |
| RP3 真实集成 | 记录实际 Rustup/RA/rust-src、宿主 revision、包摘要和能力限制 | 宿主 R2/R3：本项目 `.rs` 未保存修改、定义/引用/hover/基础补全/诊断、依赖只读导航、TS/Rust 共存、退出清理；真实鼠标/键盘与日志 |
| RP4 可选增强 | 仅在宿主策略/协议完成后声明经支持的 Cargo/proc-macro 能力 | 宿主 R4：显式构建策略、诊断来源/版本、输出上限、取消与进程树；不顺带开放 WorkspaceEdit |

每阶段分别提交本仓库文件；宿主负责主审与集成修正。代码开发和文档阶段不能相互代替：
成功激活两个 descriptor 不代表两个语言服务器可用，构建成功不代表已完成导航或诊断验收。

## 4. 测试与运行限制

- 双 descriptor 的 ID/profile/language/extension 确定性、禁用/注销、重复或未知 profile、混合项目、
  虚拟 Cargo workspace、多 crate、worktree、根外路径、证据截断均有正反例。
- 真实 Rust 验收先准备指定工具链的 RA/rust-src；本次只读调查显示宿主机器的 1.98.1 工具链
  尚缺这两个组件，不能用模拟 server 的结果冒充已兼容 Rust。准备环境属于后续实施工作。
- 复用现有“单目标直接、多目标选择”与已修复的会话记忆，不增加重复 footer 或永久授权旁路。
- 构建脚本和过程宏可能执行代码，Cargo 配置/工具链也会影响执行。插件不宣称只读沙箱；按宿主
  审批策略工作。初期关闭构建脚本、proc-macro 和保存即 Cargo check，明确部分诊断/宏能力限制。
- 自动 import、rename、格式化、代码动作、命令型 completion、macro 虚拟源码等均不默认启用。
- 本计划采用本机组件，暂不新增上游二进制包；若改为捆绑/下载，必须另记平台矩阵、版本、来源、
  许可证/notice、压缩/解压大小和摘要后再变更。不得用 latest URL 作为可重复交付依据。
- 插件独立测试/类型检查/重复打包与宿主兼容检查通过后，才交由宿主签名安装验收。无远端仓库
  创建、push、tag、Release 或发行授权。

## 5. 官方依据

- [rust-analyzer 安装与 Rustup 组件](https://rust-analyzer.github.io/book/rust_analyzer_binary.html)
- [rust-analyzer 安全边界](https://rust-analyzer.github.io/book/security.html)
- [rust-analyzer 初始化配置](https://rust-analyzer.github.io/book/configuration.html)
- [Cargo 配置层级](https://doc.rust-lang.org/cargo/reference/config.html)

选定实际组件版本后仍需验证行为，不能仅凭上游主分支文档标记完成。宿主/插件当前均未启用 Rust。

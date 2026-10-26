# Android / JVM provider 计划

- 日期：2026-10-26；状态：**仅规划，尚未实施**。
- 基线：插件 `2237b3d` / 0.2.0，SDK 1.12.0；已支持 TS/JS 和工作区内 Rust。
- 宿主主计划：[Android / JVM 语言服务兼容计划](../../asterlyn/docs/engineering/2026-10-26-android-language-services-plan.md)。
  两个仓库按同级目录组织；正式边界仍由宿主 ADR-0034 与后续冻结契约定义。
- 保留 `dev.asterlyn.lsp` 和当前仓库；本次不改 manifest、source、SDK/vendor、锁文件、服务器资源或版本，不打包/安装/发布。

## 1. 分工与选型

宿主拥有 Java 可执行文件/工具链发现、执行 trust、语言进程、Gradle 导入工作、模型/变体、缓存、只读来源、编辑和全部 UI。插件只声明经宿主验收的语言 profile / 可用能力和完整性覆盖的资源。Android/Gradle 插件继续拥有 Run/Tasks/Devices 和 Android 选择语义；两个插件通过宿主定义的只读上下文协作，不直接互调或借 task callback 跑语言服务。

候选由宿主 A0 核验：Java 优先 Eclipse JDT LS，Kotlin 优先调查官方 Kotlin LSP，普通 Groovy 调查 GroovyLanguageServer，Gradle Groovy DSL 调查 Microsoft Gradle 服务器。它们尚未被选择为产品依赖。具体发行、摘要、许可证/分发条件、运行 JDK、传输和 Android 模型支持均需通过探针。

Kotlin 官方 Alpha/实验性 Android 支持、部分闭源及独立包条款需要单独验证；不从 Android Studio 提取代码/资源，不把 VS Code 扩展操作当通用协议。若统一 Java/Kotlin 后端通过独立分发与能力闸门，可减少索引；否则分开接入并明确双向互操作限制，不默默切换后端。

## 2. 声明与版本契约

计划覆盖的文件类别为 `.java`、`.kt`、普通 `.kts`、`.groovy`、`.gradle` 与 `.gradle.kts`。复合后缀优先，脚本单独验收；不得仅扩大扩展名列表就标记可用。每份文档只有一个主语言提供者，不能重复接收相互覆盖的诊断或编辑。

1. 先冻结 profile ID、资源布局、后端/运行时/模型身份和语言选择规则，再生成新 SDK minor。SDK 1.13 或后续版本只是规划，不直接修改 1.12 的旧 tgz。
2. 新包最低宿主版本必须是真正支持 JVM 协议与桌面投影的版本；旧宿主在安装阶段拒绝未知能力。旧 TS/Rust 包在新宿主保留回归。
3. 精确 vendor 宿主的独立 SDK 制品，校验 SHA-256/SHA-512 与 npm lock；未发布开发制品明确标记，不使用 sibling 源码 import 或伪造 Release。
4. 每个 server 资源固定上游版本与完整性、保留许可证/NOTICE，记录平台/解压体积和运行要求；大 JVM 分发先比较受控本机安装与后续管理方案，不直接塞入启动包。
5. 缺少 JVM 工具或导入失败只影响相应能力；TS/Rust 和基础编辑继续可用。加载 descriptor 不启动所有 JVM、不扫描所有 flavor。

## 3. 分阶段实施

| 阶段 | 本仓库责任 | 宿主前置及验收 |
| --- | --- | --- |
| JP0 / A0 | 候选/发行与条款调查、独立启动/协议/Android 模型探针记录 | Kotlin/Java 可行性、JDK 分工、选定变体、跨语言源码映射，不用普通 JVM demo 代替 Android |
| JP1 / A1–A2 | 冻结最小 JVM 声明、SDK 制品、分语言可用/缺工具状态和本地化；配合 Android 语义上下文 | 宿主 JVM/profile、项目模型/变体、私有 IPC（若需要）、有界异步导入、缓存与只读来源基础 |
| JP2 / A3 | Java descriptor 和可重复完整包 | boostCleaner Java 的真实跨模块、Android SDK/依赖导航、hover/completion、未保存诊断 |
| JP3 / A4 | Kotlin descriptor、Java 共存与能力矩阵 | FilesRecovery + mixed fixtures；Kotlin↔Java 双向导航/引用与 dirty overlay、变体一致性 |
| JP4 / A5 | 普通 Groovy、Gradle Groovy / Kotlin DSL 逐项交付 | buildSrc、convention plugins、脚本 classpath、Gradle 访问器；未支持的脚本类别清楚降级 |
| JP5 / A6–A7 | 资源/生成代码后续声明、最终包回归与交付记录 | 独立生成授权、性能/内存、键盘/可访问性、实际包/helper/桌面/editor/native 全链路与覆盖安装 |

阶段分别提交。完整性/类型检查、协议模拟和真实 server 探针分开记录；descriptor 注册、进程存活都不能作为语言功能验收结果。宿主计划定义依赖顺序，本仓库不抢先贡献未被宿主承认的 profile。

## 4. Android 特有检查

- LSP JDK、Gradle JDK、项目编译 toolchain 和 Android SDK 分开选择；当前候选项目的 wrapper 为 8.13，不能因为 Kotlin 服务需要 JDK 25 就改变项目构建环境。
- 任务名不能作为 classpath/完整变体模型。已有 Android Run variant 只能作为经宿主验证的选择意图，不能静默替用户选择分析 flavor。
- AGP、Kotlin、Gradle、构建文件与 variant 变化使相应模型过期；普通编辑不引起重复执行授权。不得在 activation evidence 中复制大 classpath。
- Kotlin/Java 双向未保存引用需要实际后端互操作；JDT LS 与 Kotlin 同时启动不等于已经互通。禁止用搜索同名符号或写临时源文件到项目伪造效果。
- `.gradle.kts` 不等同普通 `.kt`，`.gradle` 不等同普通 Groovy；生成访问器、R、BuildConfig、Binding、KSP/KAPT、Compose 分项声明能力。
- Gradle 配置也会执行项目逻辑。默认不构建 APK、不执行 processors/生成 task；导入、网络下载和额外生成的权限分别由宿主管理，不宣称离线即沙箱。
- 取消只作用本次工作，不停止 Android Studio 或其他项目的 Gradle daemon。JVM 内存/索引缓存不共享不同窗口的 dirty state。
- SDK/依赖/归档/虚拟来源须走宿主的受控只读入口；不放开任意文件 URI 或 workspace edit。

## 5. 验收及执行记录

优先验收 boostCleaner（大型 Java/Kotlin 混合）和 FilesRecovery（Kotlin 为主），再回归 dbloodSugar_vestbag、独立 worktree 和 Kotlin DSL 最小夹具。功能路径、资源预算、阶段日志与包回滚遵从宿主主计划；XML/Manifest/资源语义另设阶段，不能只靠通用 XML server 标记支持。

本次仅完成计划与宿主边界对齐。没有安装/运行 JVM language server，没有执行目标项目 Gradle，没有新增 Android 运行能力；当前发布形态仍是插件 0.2.0 的 TS/JS/Rust。后续 JP0 首先记录真实选型探针，不把计划项写成已完成。

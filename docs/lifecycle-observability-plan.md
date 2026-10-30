# 项目启动、进度和可诊断性

日期：2026-10-30。基线 0.3.7；用户授权继续 Android 索引，并要求项目授权记忆、自动启动、进度
及仅调试时启用的操作日志。宿主计划：
`../asterlyn/docs/engineering/2026-10-30-language-service-lifecycle-plan.md`（相对于仓库同级）。

## 职责

插件 descriptor 仍无 Node/文件/进程权限。独立 server-program 负责 Android 模型适配、Java/Kotlin
初始化与真实进度；授权存储、项目自动协调、通用 UI 和日志开关属于宿主。保持 SDK 1.14.0 的
已冻结声明，不为进度赋予新的执行权限或引入 IDE 代码。

## 实施顺序

1. 先提交本计划，保持完整 0.3.7 包和既有真实项目验收记录可追溯。
2. 在现有状态协议中补充有界的通用阶段与真实计数；模型准备失败直接转为可见失败，不继续
   对用户宣称正常 indexing。对正常的 not-ready 返回明确类别，不当作后端异常。
3. 以宿主显式开关控制细粒度调试事件；只报告安全代码、关联 ID、版本、数量、耗时和状态，
   不输出源文、原始诊断/结果、原始 JVM stderr、路径或凭证。进程退出/重启和模型重载保留原因。
4. 配合宿主无打开文档时的预热，保留 Kotlin 最多两个按需模块会话的资源边界。模型/Java 就绪
   与 Kotlin 模块就绪分别表达，不用 Java-ready 冒充 Kotlin-ready；失败后允许明确重试。
5. 协议/失败/取消测试、现有 Android 语义探针和 TS/Rust 回归；记录包完整性/尺寸与实际项目
   行为后升级本地插件包，使用宿主的既有包准入/健康检查，分步提交。未经授权不发布远端。

## 验收

真实后端阶段可观察；debug off 无详细事件，debug on 可串联模型、源文版本与请求，不含源码。
坏模型/失联后端、重载/项目切换结束旧进度；重试可重新建立语义服务。FilesRecovery 模型失败的
根因由模型插件提供安全分类，不能掩盖为一直索引。最终以真实 Kotlin/Java 导航和宿主安装验收
为准，资源/生成代码、Groovy/DSL 的既有限制仍单独记录。

## 记录

- 文档阶段：基线干净；原生摘要显示 model-unavailable，但当前封装丢失了具体失败原因。

## 2026-10-30 实施记录

- 0.3.8 要求 Android Gradle >=0.6.3，确保含有效项目配置读取与自动 AGP 选择修复。
- `model → sources(实际模块完成数/总数) → backend → indexing → ready/failed` 通过原有状态通知传递；不编造整体百分比。
- 没有打开源码时，也会准备 Gradle 模型、Java 索引与所选模块的 Kotlin 后端；其他 Kotlin 模块按需启动，仍最多保留两个会话。
- Java 后端就绪即可服务；Kotlin 冷模块请求快速返回准备中，不拖住用户请求。真实配置或后端错误不再统一伪装成 ContentModified/indexing。
- 调试默认关闭，支持初始化标志与 `asterlyn/setDebugTracing` 当前会话开关；不向底层 JVM 开启原始 LSP verbose trace。
- `npm run verify`：13 项通过，包括无文档自动模型启动、真实失败分类、调试开关的端到端 stdio 验证。
- 开发探针支持 `ASTERLYN_PROJECT_INDEX_FIRST=1` 在未打开文档时等待索引，以及 `ASTERLYN_PROJECT_DEFINITIONS_ONLY=1` 仅验证跳转；证据明确记录未执行的其他检查。
- 真实项目和宿主安装验收由宿主生命周期计划统一记录。

### 包级激活一致性补强

原生 helper 联调发现清单/包版本已升至 0.3.8，但中立 descriptor 仍导出 0.3.7，激活正确拒绝。已同步 descriptor 的版本和 Gradle 最低依赖；单测比较真实 package.json/manifest.json，打包脚本还会实际导入产物核对身份及依赖，阻止仅改清单就产生不可激活包。此前无效包未覆盖安装。

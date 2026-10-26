# JP0：Android 后端探针执行结果

日期：2026-10-26。用户已授权实施并分步提交。宿主探针提交：`c32d058`。
完整版本、发行 URL / SHA-256、许可证状态、真实项目和脱敏证据见同级宿主的
[A0 执行记录](../../asterlyn/docs/benchmarks/2026-10-26-android-jvm-a0.md)。

## 结果与交付闸门

| 候选 | 实测结果 | 插件决定 |
| --- | --- | --- |
| Eclipse JDT LS 1.62.0 | 实际平台组件要求 JDK 25；独立 JDK 17 运行 Gradle 8.13。正确启用 Android 支持后，内置脚本修改 AGP 配置用途失败；控制组虽然返回 50 项目节点，真实 Java/SDK 定义均为空 | 保留 Java 候选，不注册 descriptor；先独立解决指定变体模型、后端消费和只读来源 |
| 官方 Kotlin 263.6379.0 | 发布包缺少启动要求的 EULA 文件；官方说明包含闭源部分，独立采用条款尚未满足仓库依赖政策 | 不自动接受条款，不伪造协议文件，不打包 |
| 官方 Kotlin 262.9593.0 | 独立 stdio 启动因构建过期 exit 7 | 不通过调整系统时间或混用组件绕过 |
| fwcd Kotlin LS 1.3.13 | 含 compiler 2.1.0；boostCleaner 初始化 90 秒超时，未取得 Kotlin↔Java 语义结果 | 不静默替换，不宣称兼容项目 Kotlin 2.2.0 |
| Groovy / Gradle Groovy DSL / Kotlin DSL | 尚无真实语义验收 | 继续分别保留阶段，不从 `.kt` 或普通 Groovy 支持推定脚本可用 |

A0 工具是在开发临时目录运行，并未成为产品组件。探针使用 detached 测试 worktree，
未改业务源码、wrapper、AGP、Kotlin 或用户当前分支；Gradle 配置本身会执行项目逻辑，
JDT 导入也确实生成 Eclipse 元数据，不能把 offline 模式描述成隔离环境。

## 接下来

宿主先补与后端选择无关的有界进度/状态队列；保留响应、诊断、服务器请求和未知消息的
严格容量。之后继续 AGP 模型与后端验证，证明 Java/Kotlin 双向跳转和 dirty overlays。
只有宿主实际认识并验收了 profile，才冻结 SDK minor、vendor 精确制品并新增插件声明。

本仓库本次只更新 JP0 状态和依赖边界；manifest/source、SDK 1.12.0、资源及插件 0.2.0
保持现有已验收形态。未执行打包/本机安装/原生 Android 验收，不创建远端 tag 或 Release。

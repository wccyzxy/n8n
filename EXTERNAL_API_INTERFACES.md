# n8n External Controllers API 接口

本文档列出了 `packages/cli/src/controllers/external/` 目录下的所有外部接口，这些接口主要用于内部服务间通信和多租户场景。

## 概述

External Controllers 是 n8n 的内部接口，具有以下特点：

- **跳过认证**：所有接口都设置了 `skipAuth: true`，不需要 API Key 认证
- **内部使用**：主要用于内部服务间通信，不建议对外暴露
- **多租户支持**：支持基于 `tenantId` 的多租户场景
- **基础路径**：所有接口的基础路径为 `/rest/external/`

---

**注意**：目前 `packages/cli/src/controllers/external/` 目录下没有可用的接口。所有功能已迁移到 n8n 的标准 API。

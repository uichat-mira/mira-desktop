const app = {
  app: {
    connectors: {
      description: "连接常用服务与工具，管理外部 MCP 的接入与使用权限。",
      views: { installed: "已接入", internal: "内部", external: "外部", custom: "自定义" },
      search: "搜索连接器",
      searchPlaceholder: "搜索名称、描述或能力 ID",
      clearSearch: "清除搜索",
      filterMenu: "筛选",
      resetFilters: "重置筛选",
      marketSource: "MCP 市场",
      available: "可接入",
      installationLoadFailed: "无法读取已接入记录，暂时无法接入新服务",
      cachedMarket: "当前显示最近一次成功获取的市场结果",
      cachedMarketAt: "{{message}}（{{cachedAt}}）",
      syncFailedDetail: "{{message}}：{{error}}",
      builtinEntry: "内置入口",
      open: "打开",
      manage: "管理",
      closeManager: "关闭连接器管理",
      agentAllowed: "已允许 Agent 使用",
      agentNotAllowed: "未允许 Agent 使用",
      agentAccess: "允许 Agent 使用",
      disabled: "已停用",
      enabled: "已启用",
      installed: "已接入",
      discovered: "已发现",
      capabilityCount: "{{count}} 个能力",
      noMatches: "没有匹配的连接器",
      browseMarket: "浏览市场",
      installFailed: "接入连接器失败",
      deleteFailed: "删除连接器失败",
      custom: {
        title: "添加自定义 MCP",
        editTitle: "编辑草稿：{{name}}",
        description: "粘贴 MCP 服务提供的 JSON 配置，可一次添加多个服务。",
        sessionOnly: "当前仅生成页面会话草稿，不会保存配置或启动服务。",
        modes: { local: "本地", cloud: "云端" },
        jsonLabel: "MCP 配置 JSON",
        format: "格式化",
        securityHint: "请确认配置来源可信，避免泄露密钥或执行未知命令。",
        cancel: "取消",
        confirm: "确认添加",
        add: "添加自定义 MCP",
        emptyTitle: "还没有自定义 MCP",
        emptyDescription: "添加本地命令或云端 HTTP MCP 配置，先以草稿方式整理。",
        draftStatus: "草稿 · 未保存 · 未运行",
        draftDescription: "此配置仅保存在当前页面会话中。",
        removeDraft: "移除 {{name}} 草稿",
        errors: {
          invalidJson: "JSON 格式不正确。",
          serversRequired: "请提供非空的 mcpServers 对象。",
          serverConfigInvalid: "每个服务都需要名称和对象配置。",
          mixedTransport: "同一个服务不能同时配置 command 和 url。",
          modeMismatch: "配置方式与当前选择的本地／云端模式不一致。",
          localCommandRequired: "本地服务需要填写非空 command。",
          localArgsInvalid: "args 必须是字符串数组。",
          localEnvInvalid: "env 必须是字符串键值对象。",
          cloudUrlRequired: "云端服务需要填写 HTTP(S) url。",
          cloudUrlInvalid: "url 必须是有效的 HTTP 或 HTTPS 地址。",
          cloudHeadersInvalid: "headers 必须是字符串键值对象。",
          unsupportedProperty: "配置包含当前表单不支持的字段。",
        },
      },
      builtins: {
        knowledgeBase: {
          name: "知识库",
          description: "管理本地文档与索引，为对话提供检索依据。"
        },
        github: {
          name: "GitHub",
          description: "连接 GitHub，管理项目访问与仓库协作。"
        },
        notion: {
          name: "Notion",
          description: "连接 Notion 工作区，管理页面、数据库与知识同步。"
        },
        mailCenter: {
          name: "邮件中心",
          description: "配置邮件账户，浏览和管理邮件。"
        },
        newsHub: {
          name: "观澜",
          description: "管理资讯来源，浏览、检索与阅读新闻。"
        },
        touchRealm: {
          name: "触界",
          description: "连接当前 Chrome，配置扩展授权并使用见行与剪藏。"
        },
        codeGraph: {
          name: "CodeGraph",
          description: "查看代码索引能力、运行条件和配置。"
        }
      }
    },
    navigation: {
      home: "主页",
      projects: "知识与评测",
      forge: "淬行",
      remoteAccess: "远程连接",
      cloudAccount: "云账号",
      dashboard: "工作台",
      extensions: "扩展",
      capabilities: "能力",
      connectors: "连接器",
      skills: "技能",
      settings: "设置",
      help: "帮助",
      helpOpenFailed: "帮助页面打开失败，请稍后重试。",
      account: "账户",
      about: "关于",
      development: "开发",
      knowledgeBase: "知识库",
      evaluation: "评测中心",
      externalApp: "应用外",
      primary: "主导航",
    },
    sidebar: {
      unknown: "检测中",
      running: "运行中",
      stopped: "未启动",
      unknownUser: "未知用户",
      logout: "退出登录",
    },
  },
} as const;

export default app;

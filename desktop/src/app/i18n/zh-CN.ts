const app = {
  app: {
    navigation: {
      home: "主页",
      projects: "知识与评测",
      forge: "淬行",
      remoteAccess: "远程连接",
      dashboard: "工作台",
      extensions: "扩展",
      tools: "工具",
      mcp: "MCP",
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

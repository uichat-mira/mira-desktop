const skillsZh = {
  settings: {
    skills: {
      metadata: {
        labels: {
          id: "技能 ID",
          name: "名称",
          displayName: "显示名称",
          description: "描述",
          version: "版本",
          category: "分类",
          visibility: "可见范围",
          source: "来源",
          status: "状态",
          executionContext: "执行模式",
          executionAgent: "执行智能体",
          allowedTools: "可用工具",
          runtimeBindings: "运行时绑定",
          workspaceBound: "工作区范围",
        },
        values: {
          visibility: {
            public: "公开",
            private: "私有",
          },
          status: {
            active: "可用",
            review: "待审核",
            draft: "草稿",
            deprecated: "已停用",
          },
          executionContext: {
            fork: "独立执行",
            inline: "主智能体执行",
          },
          executionAgent: {
            subAgent: "子智能体",
            mainAgent: "主智能体",
          },
          workspaceBound: {
            true: "仅当前工作区",
            false: "不限工作区",
          },
          tools: {
            readDiscover: "发现文件",
            readOpen: "读取文件",
            terminalSession: "终端",
            githubRepository: "GitHub 仓库",
            githubPullRequest: "GitHub Pull Request",
            githubActions: "GitHub Actions",
          },
        },
      },
    },
  },
} as const;

export default skillsZh;

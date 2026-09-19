const enUS = {
  common: {
    actions: {
      cancel: "Cancel",
      approve: "Approve",
      reject: "Reject",
      confirm: "Confirm",
      reset: "Reset",
      save: "Save",
      backToChat: "Back to Chat",
      close: "Close",
      view: "View",
      download: "Download",
      delete: "Delete",
      refresh: "Refresh",
      start: "Start",
      generate: "Generate",
      more: "More",
      collapse: "Collapse",
    },
  },
  chat: {
    sidebar: {
      newConversation: "+ New Conversation",
      untitledConversation: "New Conversation",
      archive: "Archive",
      delete: "Delete",
      tools: {
        search: "Chat Search",
        searchDescription: "Find previous threads quickly",
        searchTitle: "Chat Search",
        searchInputLabel: "Search Threads",
        searchPlaceholder: "Search by thread title or ID",
        searchEmpty: "No matching threads found",
        workspace: "Workspace",
        workspaceDescription: "View or switch the Agent workspace root",
        workspaceTitle: "Workspace",
        workspaceInputLabel: "Workspace Path",
        workspacePlaceholder: "For example D:\\workspace\\rag-demo",
        workspaceCurrent: "Current Workspace",
        workspaceUnset: "Workspace not set",
        workspaceUnsetBadge: "Unset",
        workspaceBound: "Bound",
        workspaceApply: "Apply Workspace",
        workspaceRequired: "Enter a workspace absolute path first",
        workspaceUpdated: "Workspace updated",
        workspaceLoadFailed: "Failed to load workspace",
        workspaceUpdateFailed: "Failed to update workspace",
        currentThread: "Current Thread",
      },
    },
  },
  settings: {
    navigation: {
      general: "General",
      model: "Models",
      workspace: "Workspace",
      basicConfig: "Basic Config",
      knowledgeGroup: "Knowledge",
      appGroup: "App",
      otherGroup: "Other",
      knowledgeBase: "Knowledge Base",
      integration: "Integration",
      developmentGroup: "Development",
      persona: "Role",
      roles: "Roles",
      skills: "Skills",
      personas: "Roles",
      evaluationCenter: "Knowledge Evaluation Center",
      development: "Development",
      developmentLogs: "Logs",
      mcp: "MCP Marketplace",
      tools: "Tools",
      about: "About",
    },
    knowledgeBase: {
      page: {
        miniTitle: "Knowledge Base",
        title: "Knowledge Base",
        descriptionFallback:
          " Double-click any row to open details, or choose Add File to start the step-by-step upload flow.",
        emptyTitle: "No knowledge base selected",
      },
      actions: {
        metadata: "Metadata",
        addFile: "Add File",
        rebuildIndex: "Rebuild Index",
        confirmRebuild: "Confirm Rebuild",
        deleteDocument: "Delete Document",
        confirmDelete: "Confirm Delete",
        backToKnowledgeBase: "Back to Knowledge Base",
        testRetrieval: "Test Retrieval Now",
      },
      messages: {
        rebuildPending:
          "Rebuild index is coming soon. Current document: {{name}}",
        deleted: "Deleted {{name}}",
        deleteFailed: "Failed to delete document",
        uploadRequiresEmbedding:
          "Please connect a default embedding model before uploading knowledge base files",
        loadingDocuments: "Loading knowledge base documents...",
        loadingDetail: "Loading document details...",
        retrievalStarted: "Started retrieval test for {{name}}",
      },
      metadataModal: {
        title: "Metadata Overview",
        totalDocuments: "Total Documents",
        totalDocumentsDescription:
          "Number of documents in the current knowledge base",
        enabledDocuments: "Available Documents",
        enabledDocumentsDescription:
          "Documents currently available for retrieval",
        totalChunks: "Total Chunks",
        totalChunksDescription:
          "Counted from the current document chunking results",
        summary:
          "This page is already connected to the real knowledge base API. We can later extend it with index quality, citation counts, and retrieval performance statistics.",
      },
      rebuildModal: {
        title: "Rebuild Index",
        description:
          "This will rerun chunking, vectorization, and index writing for {{name}}.",
        warning:
          "This capability is still being integrated, so confirming will currently show a placeholder message.",
      },
      deleteModal: {
        description:
          "After deletion, {{name}} and its related chunks and index data will be removed.",
        warning:
          "This action cannot be undone. Please confirm before continuing.",
      },
      banner:
        "No default vector model is connected right now, so knowledge base uploads are temporarily disabled.",
      filters: {
        searchPlaceholder: "Search document name, source, or status",
        sortPrefix: "Sort:",
        selectAllAria: "Select all visible rows",
        rowSelectAria: "Select {{name}}",
        moreActionsAria: "Open more actions for {{name}}",
      },
      table: {
        index: "#",
        name: "Name",
        segmentMode: "Segment Mode",
        charCount: "Chars",
        hits: "Hits",
        uploadedAt: "Uploaded At",
        status: "Status",
        actions: "Actions",
        empty:
          "There are no knowledge base files yet. Click Add File to start uploading.",
        tip: "Tip: double-click any row to open document details, and Add File will take you into the step-by-step upload flow.",
        summary: "{{total}} total documents, {{visible}} currently shown",
        stats: "{{enabled}} available documents · {{chunks}} total chunks",
      },
      status: {
        processing: "Processing",
        enabled: "Available",
        disabled: "Disabled",
        failed: "Index failed",
      },
      detail: {
        notFoundTitle: "Document Not Found",
        notFoundDescription:
          "The `id` in the current URL does not match any real document. Please return from the knowledge base list.",
        previewTitle: "Chunk Preview",
        previewDescription:
          "This shows 10 evenly distributed real chunks so you can quickly verify the content after ingestion.",
        noChunks: "This document does not have chunk results yet.",
        chunkLabel: "Chunk {{index}}",
        basicInfo: "Basic Information",
        documentId: "Document ID",
        sourceType: "Source / Type",
        createdUpdated: "Created / Updated",
        tags: "Tags",
        charCount: "Character Count",
        charCountDescription:
          "Current stored character volume of this document",
        chunkCount: "Chunk Count",
        chunkCountDescription: "Counted from the real chunking results",
        fileSize: "File Size",
        fileSizeDescription: "Original size recorded at upload time",
        statusLabel: "Status",
        statusDescription: "Current index availability state for this document",
        emptySummary:
          "This document does not have a previewable content summary yet.",
      },
    },
    wecom: {
      page: {
        miniTitle: "WeCom",
        title: "WeCom",
        description: "Configure WeCom integration, robot, and smart robot knowledge base.",
      },
      config: {
        corpId: "CorpID",
        agentId: "AgentID",
        appSecret: "Self-built App Secret",
        contactsSecret: "Contacts Secret",
        smartRobotBotId: "Smart Robot Bot ID",
        smartRobotSecret: "Smart Robot Secret",
        smartRobotKnowledgeBaseId: "Smart Robot Knowledge Base",
        smartRobotReplyMode: "Smart Robot Reply Mode",
        smartRobotReplyModeStream: "Stream reply (replyStream)",
        smartRobotReplyModeSend: "Active send (sendMessage)",
        smartRobotKnowledgeBaseDefault: "Default Knowledge Base",
        smartRobotKnowledgeBaseSystem: "System",
        testMessage: "Test message content",
      },
      actions: {
        refresh: "Refresh",
        saveConfig: "Save Config",
        startSmartRobot: "Start Smart Robot",
        stopSmartRobot: "Stop Smart Robot",
        sendTestMessage: "Send Test Message",
      },
      status: {
        title: "Current Status",
        description: "View config, connection status, and recent errors.",
        smartRobot: "Smart Robot",
        smartRobotBotId: "Bot ID",
        smartRobotKnowledgeBase: "Knowledge Base",
        smartRobotKnowledgeBaseDefault: "Default Knowledge Base",
        smartRobotLastError: "Recent Error",
        smartRobotMissingTitle: "Smart robot is not fully configured",
        smartRobotMissingDescription:
          "Fill in the Bot ID and Secret before starting the connection.",
      },
      messages: {
        loadFailed: "Failed to load WeCom configuration",
        configSaved: "Configuration saved",
        configSaveFailed: "Failed to save configuration",
        smartRobotStarted: "Smart robot started",
        smartRobotStartFailed: "Failed to start smart robot",
        smartRobotStopped: "Smart robot stopped",
        smartRobotStopFailed: "Failed to stop smart robot",
        testMessageMissing: "Please enter a test message",
        testMessageSent: "Test message sent",
        testMessageFailed: "Failed to send test message",
      },
    },
    mcp: {
      config: {
        endpointUrl: "Endpoint URL",
        bearerToken: "Bearer Token",
        timeoutMs: "Timeout (ms)",
        customHeadersJson: "Custom Headers JSON",
        cwd: "Working Directory",
        envJson: "Environment Variables JSON",
        authType: "Auth Type",
        authTypeNone: "No Auth",
        authTypeBearer: "Bearer Token",
        knownPartial: "Some fields are inferred from known capability metadata.",
        notesTitle: "Notes",
        cancel: "Cancel",
        save: "Save",
        saveLoading: "Saving...",
        clearTokenHint: "Saving an empty token will clear the current token.",
        loading: "Loading...",
        title: "Configure {{name}}",
      },
      messages: {
        configLoadFailed: "Failed to load configuration",
        configSaveSucceeded: "Configuration saved",
        configSaveFailed: "Failed to save configuration",
      },
    },
      evaluation: {
      shared: {
        modeRetrieve: "Retrieve Only",
        modeRetrieveGenerate: "Retrieve + Generate",
        statusPass: "Pass",
        statusWarning: "Warning",
        statusError: "Error",
        sampleCount: "{{count}} samples",
        documentCount: "{{count}} documents",
        uploadedAt: "Uploaded at {{value}}",
        createdAt: "Created at {{value}}",
        completedAt: "Completed at {{value}}",
        noValue: "None",
      },
      status: {
        idle: "Not Started",
        ready: "Ready",
        queued: "Queued",
        running: "Running",
        completed: "Completed",
        failed: "Partially Failed",
        saved: "Saved",
      },
      metrics: {
        hitAtK: "Hit@K Retrieval Accuracy",
        recallAtK: "Recall@K Average Coverage",
        mrr: "MRR Ranking Quality",
        faithfulness: "Faithfulness to Sources",
        answerRelevance: "Relevance to Question",
        answerCompleteness: "Completeness of Answer",
        sourceHitRate: "Source Hit Rate",
        averageLatency: "Avg Latency  {{count}} failed",
      },
      workbench: {
        page: {
          miniTitle: "Evaluation Workbench",
          title: "Evaluation Workbench",
          description:
            "Upload a packaged evaluation ZIP to parse its dataset and runtime settings. This page focuses on validation and preview only; adjust parameters by regenerating the ZIP.",
        },
        actions: {
          generatePackage: "Generate Package",
          startEvaluation: "Start Evaluation",
        },
        messages: {
          uploadZip: "Please upload a dataset.zip evaluation package",
          parseSuccess: "Evaluation package parsed. You can start the run now.",
          parseFailed: "Failed to parse the evaluation package",
          uploadFirst: "Please upload an evaluation package first",
          validationError:
            "This evaluation package has validation errors. Please fix them and upload again.",
          runCreateFailed: "Failed to create the evaluation run",
          missingKnowledgeBaseId:
            "This evaluation package is missing a valid knowledge base id. Regenerate it or fix manifest.json before retrying.",
          unknownKnowledgeBase:
            "This evaluation package references a knowledge base that no longer exists. Regenerate it or fix the package before retrying.",
          runCreated:
            "Evaluation run created and will appear automatically in the Evaluation Center",
        },
        stateBar: {
          taskStatus: "Task Status",
          dataset: "Dataset",
          progress: "Progress",
          mode: "Mode",
          params: "Params",
          waitingUpload: "Waiting for upload",
        },
        preview: {
          closeMask: "Close dataset preview",
          closeDrawer: "Close preview drawer",
          title: "Random Dataset Preview",
          samplePreview: "Sample Preview",
          documentPreview: "Document Preview",
          goldSources: "Gold Sources",
          reference: "Reference",
        },
        packageCard: {
          title: "Package and Parameters",
          description:
            "After upload, the ZIP is parsed for mode, topK, topN, and N. This page is read-only for parameters.",
          parsing: "Parsing evaluation package, please wait...",
          helper:
            "dataset.zip is supported. Upload again to replace the current package.",
          dataset: "Dataset",
          knowledgeBase: "Knowledge Base",
          runtimeConfig: "Runtime Config",
          openPreview: "Open Preview",
          previewHint:
            "The preview opens in a drawer so the main layout stays focused.",
        },
        validation: {
          title: "Pre-run Validation",
          hint: "Think of this like form validation: fix the ZIP content and upload it again.",
          empty:
            "Validation results for package structure, sample fields, and reference data will appear here after parsing.",
        },
        console: {
          log: "Run Log",
          result: "Results",
          savedHint:
            "This run has been automatically registered in the Evaluation Center",
          unsavedHint: "A run will be registered automatically after creation",
          emptyLog:
            "After you upload a package, parsing progress and runtime logs will appear here.",
          summary: "Summary",
          success: "Success",
          failure: "Failure",
          emptyResultTitle: "Results are empty for now",
          emptyResultDescription:
            "Once the evaluation starts, the right panel will switch to the Results tab automatically and show summary metrics for this run.",
          resultSummary: "{{count}} results aggregated",
        },
      },
      center: {
        page: {
          miniTitle: "Evaluation Center",
          title: "Evaluation Center",
          description:
            "Completed evaluation runs are stored here. The table stays concise, and the drawer reveals configuration, metrics, logs, and sample details.",
        },
        messages: {
          loadFailed: "Failed to load evaluation runs",
          downloadStarted: "Started downloading {{name}}.md",
          exportFailed: "Failed to export Markdown",
          deleted: "Deleted evaluation run {{name}}",
          deleteFailed: "Failed to delete evaluation run",
          bulkDeleted: "Deleted {{count}} evaluation runs",
          bulkDeleteFailed: "Batch deletion failed",
        },
        deleteModal: {
          title: "Delete Evaluation Run",
          description:
            "After deletion, {{name}} and all of its metrics, logs, and sample results will be removed.",
          warning:
            "This action cannot be undone, and running tasks cannot be deleted.",
          confirm: "Delete",
          deleting: "Deleting...",
        },
        bulkDeleteModal: {
          title: "Delete Selected Evaluation Runs",
          description:
            "You selected {{count}} evaluation runs. Deleting them will remove their results, logs, and sample details.",
          confirm: "Delete",
          deleting: "Deleting...",
          success: "Deleted {{count}} evaluation runs",
          partialFailed: "Failed to delete {{count}} runs",
        },
        table: {
          name: "Run Name",
          knowledgeBase: "Knowledge Base",
          status: "Status",
          sampleCount: "Samples",
          keyMetrics: "Key Metrics",
          completedAt: "Completed At",
          actions: "Actions",
        },
        searchPlaceholder: "Search run name or dataset",
        bulkDelete: "Delete Selected",
        recordCount: "Runs: {{count}}",
        loading: "Loading evaluation runs...",
        empty:
          "There are no evaluation runs yet. Create one from the Evaluation Workbench and it will appear here.",
        noMatch: "No evaluation runs match the current search.",
      },
      detailDrawer: {
        closeMask: "Close details drawer",
        closeDrawer: "Close drawer",
        runtimeConfig: "Runtime Config",
        dataset: "Dataset",
        knowledgeBase: "Knowledge Base",
        aiAnswer: "AI Answer",
        referenceAnswer: "Reference Answer",
        modeRepeat: "Mode {{mode}} · Repeat {{count}} times",
        datasetSummary: "Documents {{documents}} · Samples {{samples}}",
        validations: "Validation Results",
        sampleDetails: "Sample Details",
        sampleStatusLine: "{{id}} · {{status}} · {{latency}}",
        success: "Success",
        failure: "Failure",
        goldSources: "Gold Sources",
        matchedSources: "Matched",
        recall: "Recall",
        faithfulness: "Faithfulness",
        relevance: "Relevance",
        completeness: "Completeness",
        retrievedSources: "Retrieved Sources",
        noRetrievedSources: "No retrieved sources available to display.",
        attempts: "Attempts",
        attempt: "Attempt {{count}}",
        attemptRecall: "recall {{value}}",
        attemptRelevance: "rel {{value}}",
        attemptCompleteness: "comp {{value}}",
        runLogs: "Run Logs",
        deleteRecord: "Delete Run",
        deleting: "Deleting...",
        downloadMarkdown: "Download Markdown",
      },
      packageGenerator: {
        title: "Generate Evaluation Package",
        intro:
          "Sample documents and chunks from the current default knowledge base, use the long-term evaluation model from Model Settings to generate questions and reference answers, then export an uploadable ZIP package.",
        provider: "Current Evaluation Provider",
        model: "Current Evaluation Model",
        notConfigured: "Not Configured",
        configureModelFirst: "Configure it first in Model Settings",
        preset: "Preset Scheme",
        presets: {
          fast: {
            label: "Quick Validation",
            description:
              "8 / 4 / 2, TopK 10, TopN 5. Best for checking whether the flow and output look right.",
          },
          balanced: {
            label: "Balanced Default",
            description:
              "12 / 6 / 3, TopK 10, TopN 5. Good for regular generation with a balanced speed/coverage tradeoff.",
          },
          strict: {
            label: "Strict Evaluation",
            description:
              "20 / 10 / 3, TopK 15, TopN 5. Best for a more serious evaluation, but it takes longer.",
          },
        },
        sourceKnowledgeBase: "Source Knowledge Base",
        defaultKnowledgeBase: "Default Knowledge Base",
        loadingKnowledgeBases: "Loading knowledge bases...",
        defaultKnowledgeBaseHint:
          "The default knowledge base can generate evaluation packages like any other knowledge base, but it cannot be deleted.",
        selectedKnowledgeBaseHint:
          'The package will be generated from available documents and chunks in "{{name}}".',
        selectKnowledgeBaseHint: "Select a knowledge base to use as the source for this package.",
        datasetName: "Dataset Name",
        sampleCount: "Sample Count",
        documentCount: "Sampled Documents",
        chunksPerDocument: "Chunks per Document",
        mode: "Mode",
        concurrency: "Concurrency",
        timeoutSeconds: "Timeout (sec)",
        modeRetrieveGenerate: "Retrieve + Generate",
        modeRetrieve: "Retrieve Only",
        summary:
          "This version samples available documents and chunks from the selected knowledge base and uses the configured evaluation model to generate samples. The exported ZIP can be uploaded back into this workbench directly.",
        combinedGuidance:
          "This package first samples documents and chunks from the selected knowledge base, then uses the configured evaluation model to generate samples and export a ZIP. The preset controls the default sampling strength, while the source knowledge base defines the material scope.",
        checkingAvailability:
          "Checking available documents in the selected knowledge base...",
        readyDocumentCount:
          "Enabled and ready documents available for generation: {{count}}",
        readyResourceCount:
          "Enabled and ready documents available for generation: {{documents}} · chunks: {{chunks}}",
        noReadyDocuments:
          "The selected knowledge base has no enabled and ready documents, so package generation is unavailable.",
        noReadyDocumentsForSelected:
          "The selected knowledge base has no enabled and ready documents, so package generation is unavailable.",
        generating: "Generating...",
        generateAndDownload: "Generate and Download",
        messages: {
          configureEvaluationModel:
            "Please configure a default evaluation model in Model Settings first",
          noReadyDocuments:
            "The selected knowledge base has no enabled and ready documents, so package generation is unavailable",
          selectKnowledgeBase: "Please select a knowledge base first",
          generated: "Evaluation package generated and download started",
          failed: "Failed to generate evaluation package",
        },
        help: {
          datasetName:
            "The exported package name, mainly for distinguishing batches. It does not affect evaluation logic.",
          sampleCount:
            "How many evaluation samples to generate. For example, 8 will create 8 questions with reference answers.",
          documentCount:
            "How many documents to sample from the selected knowledge base for this package. Larger values spread the source material more widely.",
          chunksPerDocument:
            "How many chunks to take from each sampled document as question material. Larger values cover more content per document.",
          mode: "Retrieve Only evaluates retrieval quality. Retrieve + Generate also creates reference Q&A and is better for end-to-end RAG evaluation.",
          topK: "How many candidate chunks to retrieve first at runtime. Higher values improve coverage but may add noise.",
          topN: "How many items from TopK are kept for downstream evaluation or generation. Usually this should be less than or equal to TopK.",
          repeat:
            "How many times each sample is executed. Useful for observing stability; 1 means each sample runs once.",
          concurrency:
            "How many sample tasks run at the same time. Higher values are faster but use more model and machine resources; for local models, start with 1.",
          timeoutSeconds:
            "How long a single sample may run before being marked as failed. Increase it if local models are slow.",
        },
      },
    },
    general: {
      page: {
        miniTitle: "General",
        title: "General",
        description:
          "Manage interface preferences and account actions in one place.",
      },
      preferences: "Preferences",
      language: {
        label: "Interface Language",
        options: {
          "zh-CN": "Simplified Chinese",
          "en-US": "English",
        },
      },
      theme: {
        label: "Color Theme",
        presets: {
          "warm-neutral": {
            label: "Warm Neutral",
            description:
              "Keeps the paper-like warmth of the current product, ideal for long reading, configuration, and review sessions.",
          },
          "knowledge-blue": {
            label: "Iron Ink Purple",
            description:
              "Uses low-saturation iron-ink purple-gray tones to create a calm, professional, and judgmental interface for retrieval, citations, and long reading sessions.",
          },
          "archive-green": {
            label: "Archive Green",
            description:
              "A calmer, more restrained tone for long document reviews, log analysis, and knowledge base work.",
          },
          "slate-ocean": {
            label: "Slate Ocean",
            description:
              "Cool and steady without feeling harsh, well suited to monitoring, debugging, and system status views.",
          },
        },
      },
      darkMode: {
        label: "Dark Mode",
        ariaLabel: "Toggle dark mode",
      },
      cleanup: {
        label: "Clear Conversation History",
        description:
          "Delete all of this account's conversations and messages, remove their conversation workdirs, attachments, and generated media, and clear server logs. Workspaces are not changed.",
        action: "Clear Now",
        title: "Confirm Conversation Cleanup",
        confirmDescription:
          "This permanently deletes all of this account's conversations, messages, conversation workdirs, attachments, generated media, and server logs. Workspaces are not changed.",
        confirm: "Clear Conversations",
        success: "Cleared {{threads}} conversations and {{media}} media files; {{messages}} messages and {{logs}} KB of server logs cleared.",
        partial:
          "Cleared {{threads}} conversations and {{media}} media files; {{messages}} messages and {{logs}} KB of server logs cleared; {{failed}} cleanup item(s) could not be cleared.",
        empty: "There are no conversations or media files to clear. Server logs were cleared.",
        failed: "Failed to clear conversations. Please try again.",
      },
      account: {
        changePassword: "Change Password",
      },
      proxy: {
        title: "SOCKS5 Proxy",
        description: "Leave host or port empty to keep the proxy disabled.",
        host: "SOCKS5 Host",
        hostPlaceholder: "For example 127.0.0.1",
        port: "SOCKS5 Port",
        portPlaceholder: "For example 1080",
        username: "Username",
        usernamePlaceholder: "Optional",
        password: "Password",
        passwordPlaceholder: "Optional",
        save: "Save proxy settings",
        saving: "Saving...",
        saveSuccess: "Proxy settings saved",
        saveFailed: "Failed to save proxy settings",
        loadFailed: "Failed to load proxy settings",
        portInvalid: "Port must be an integer between 1 and 65535",
      },
      password: {
        modalTitle: "Change Password",
        title: "Change Password",
        description:
          "Your new password must be at least 6 characters and different from the current one. Changes take effect immediately after saving.",
        current: "Current Password",
        currentPlaceholder: "Enter your current password",
        next: "New Password",
        nextPlaceholder: "Enter a new password",
        confirm: "Confirm New Password",
        confirmPlaceholder: "Enter the new password again",
        mismatch: "The new passwords do not match",
        sameAsCurrent:
          "The new password must be different from the current password.",
        submitInvalid: "Please review the password fields before submitting.",
        success:
          "Password updated. Please use the new password for future sign-ins.",
        failed: "Failed to change password. Please try again later.",
        submit: "Update Password",
        submitting: "Saving...",
      },
      health: {
        title: "Runtime Platform",
        detailAriaLabel: "View details",
        services: {
          server: "Server",
          sqlite: "SQLite",
          sqliteVec: "SQLite-vec",
        },
        details: {
          desktopBackendUnavailable:
            "Desktop runtime is not connected to the local backend",
          desktopDatabaseUnavailable:
            "Desktop runtime is not connected to database checks",
          desktopVectorUnavailable:
            "Desktop runtime is not connected to vector store checks",
          waitingBackend: "Waiting for backend health check",
          waitingDatabase: "Waiting for database connectivity check",
          waitingVector: "Waiting for vector store check",
          databaseUnexpected:
            "Database health check returned an unexpected status",
          backendRunning: "Backend is running · {{url}}",
          backendUnavailableForDatabase:
            "Backend is unavailable, so database status cannot be checked",
          backendUnavailableForVector:
            "Backend is unavailable, so vector extension status cannot be checked",
          healthCheckFailed: "Health check failed",
        },
        logs: {
          export: "Export Logs ZIP",
          exporting: "Exporting...",
          exportSuccess: "Log archive download has started",
          exportFailed: "Failed to export logs",
          clear: "Clear Logs",
          clearTitle: "Confirm Log Cleanup",
          clearDescription:
            "This will clear the current contents of `server.log` and `error.log`.",
          clearWarning:
            "The log files will remain, but their contents will be removed. This action cannot be undone.",
          clearConfirm: "Clear Logs",
          clearSuccess: "Logs cleared, {{size}} KB released",
          clearFailed: "Failed to clear logs",
        },
        summary:
          'Basic runtime status stays here, while detailed database and vector-extension diagnostics moved to "Development > Database".',
      },
    },
    roles: {
      page: {
        title: "Roles",
          description: "Turn roles into a role design workbench.",
      },
      actions: {
        new: "New Role",
        import: "Import Role",
        delete: "Delete Role",
        preview: "Preview",
        guide: "Field Guide",
        editContent: "Edit Content",
        copySuffix: "Copy",
      },
      editor: {
        title: "Edit Role",
        hint: "Adjust role definition and prompt structure.",
      },
        list: {
          title: "Role List",
          hint: "Reusable prompt prototypes live here.",
        },
        fields: {
          title: "Core Fields",
          hint: "Each field opens in its own drawer, while the main surface stays summary-first.",
          empty: "Not filled yet",
        },
        status: {
          published: "Published",
          default: "Default",
          active: "Active",
          draft: "Draft",
        },
      header: {
        previewOnly: "Prompt prototype",
      },
      form: {
        name: "Name",
        summary: "Summary",
        persona: "Role Core",
        personaHelp: "Defines role identity and tone.",
        scenario: "Scenario",
        scenarioHelp: "Defines the usage scenario.",
        worldview: "Worldview",
        worldviewHelp: "Defines the role's basic view of the world.",
        exampleDialogues: "Example Dialogues",
        exampleDialoguesHelp: "Add representative Q&A snippets.",
        style: "Writing Style",
        constraints: "Constraints",
      },
      preview: {
        title: "Prompt Preview",
        hint: "Inspect the assembled result with knowledge base context.",
        chat: "Chat",
        rag: "RAG",
        testInput: "Test input",
        stackTitle: "Context Stack",
        blockTitle: "Prompt Block Preview",
        mode: "Mode",
        persona: "Role",
        roleName: "Role Name",
        roleSummary: "Role Summary",
        roleWorldview: "Worldview",
        rolePersona: "Role Core",
        roleScenario: "Scenario",
        roleExamples: "Example Dialogues",
        roleStyle: "Writing Style",
        roleConstraints: "Constraints",
        input: "Input",
        systemPrompt: "System prompts hold product-wide rules and safety boundaries.",
        knowledgeInjected: "Knowledge base context is injected before generation.",
        knowledgeSkipped: "Previewing role only, without knowledge context.",
        close: "Close preview",
        closeMask: "Close prompt preview",
        layers: {
          system: "System Layer",
          role: "Role Layer",
          knowledge: "Knowledge Layer",
          history: "History Layer",
        },
        historyNotice: "History keeps context continuity, but it does not replace role definition.",
      },
      prompt: {
        notice: "Prompt block preview.",
      },
      guide: {
        name: {
          title: "Name",
          description: "The quickest way to identify the role.",
        },
        worldview: {
          title: "Worldview",
          description: "The role's underlying view of the world.",
        },
        persona: {
          title: "Role Core",
          description: "Identity, tone, and stable behavior.",
        },
        scenario: {
          title: "Scenario",
          description: "The kind of situation this role works in.",
        },
        exampleDialogues: {
          title: "Example Dialogues",
          description: "Show how the role usually responds.",
        },
        style: {
          title: "Writing Style",
          description: "Controls sentence length, tone, and density.",
        },
        constraints: {
          title: "Constraints",
          description: "Hard boundaries the role should not cross.",
        },
      },
        content: {
          title: "Role Content",
          hint: "Compose the core fields here; the main surface only keeps name and summary.",
          close: "Close editor",
          closeMask: "Close role content",
        },
        fieldDrawer: {
          close: "Close field editor",
          closeMask: "Close field editor drawer",
        },
        fieldHelp: {
          syntax: "Suggested Pattern",
          good: "Good Example",
          bad: "Avoid",
        },
        fieldNotes: {
          worldview:
            "Define the role's underlying model of the world and how it reasons through problems. This is the base layer for later judgment, tradeoffs, and framing.",
          persona:
            "Define identity, stance, relationship tone, and stable behavior. This decides who the role is and how it tends to respond, rather than describing a temporary task.",
          scenario:
            "Limit the role's usual working context, task space, and target boundary. This helps the model decide when to take initiative and when to stay restrained.",
          exampleDialogues:
            "Provide a few high-value examples that show how the role responds, advances, refuses, or clarifies. Keep them selective and representative rather than exhaustive.",
          style:
            "Constrain expression: sentence shape, pacing, answer length, information density, and tone. This controls how the role speaks, not which facts it uses.",
          constraints:
            "State hard boundaries, required rules, and conflict priorities. Use this field for non-negotiable guardrails instead of repeating persona description.",
        },
        fieldExamples: {
          worldview: {
            syntax:
              "Cover three things in order:\n- What the role believes\n- How it judges facts and risk\n- What it prioritizes in conflict",
            good:
              "You believe conclusions should be grounded in evidence.\nWhen information conflicts, you separate assumptions from verified facts first.\nIf speed and accuracy compete, you protect accuracy before polish.",
            bad:
              "You are very wise and deep.\nYou have a good worldview.\nPlease help me finish this report now.",
          },
          persona: {
            syntax:
              "Write three stable parts:\nRole identity: ...\nAttitude toward {{user}}: ...\nStable behavior: ...",
            good:
              "Role identity: You are a restrained product review assistant who leads with the conclusion.\nAttitude toward {{user}}: You stay collaborative and professional without flattery.\nStable behavior: You first decide whether a claim holds, then explain the reason and next step.",
            bad:
              "You are kind, smart, and amazing.\nYou can do everything.\nYour task right now is to rewrite my article.",
          },
          scenario: {
            syntax:
              "Treat this like stage directions:\nPlace or environment: ...\nRelationship: ...\nCurrent situation: ...\nGoal or tone: ...",
            good:
              "Place or environment: The team is reviewing a feature that is close to launch.\nRelationship: {{user}} owns the project and you are the reviewer.\nCurrent situation: The proposal is incomplete, but a directional judgment is needed.\nGoal or tone: Keep the exchange professional, restrained, and decision-oriented.",
            bad:
              "You grew up in a complicated world.\nYou are a cautious person.\nIn the end everyone succeeds and celebrates.",
          },
          exampleDialogues: {
            syntax:
              "Use short multi-turn dialogue:\n{{user}}: ...\n{{char}}: ...\n\nEach block should show one clear speaking pattern.",
            good:
              "{{user}}: Can this plan ship?\n{{char}}: Yes, but only after the rollback path and exception flow are covered.\n\n{{user}}: Why do you start with risk?\n{{char}}: Because the cost of missing it later is usually higher.",
            bad:
              "The role usually analyzes first and then gives advice.\nThis section should feel professional.\nHere are some general product principles: ...",
          },
          style: {
            syntax:
              "Focus only on expression:\nSentence length: ...\nTone: ...\nStructure: ...\nInformation density: ...",
            good:
              "Sentence length: Prefer short sentences, then extend only when needed.\nTone: Calm and direct, without exaggeration.\nStructure: Lead with the conclusion, then expand in bullets.\nInformation density: Keep filler low and preserve the reasoning.",
            bad:
              "You are a product expert.\nYou know many industry facts.\nYou help users solve every problem.",
          },
          constraints: {
            syntax:
              "Use explicit rules with visible priority:\nMust: ...\nMust not: ...\nWhen rules conflict, prioritize: ...",
            good:
              "Must: Keep conclusions tied to information the user actually provided.\nMust not: Invent unverified facts or numbers.\nWhen rules conflict, prioritize accuracy before completeness.",
            bad:
              "Try to do better.\nDo not be weird.\nAnswer depending on the situation.",
          },
        },
        messages: {
          created: "Created a new role draft",
          imported: "Imported role copy",
          saved: "Role saved",
          deleted: "Role {{name}} deleted",
        reset: "Restored current role state",
      },
      deleteModal: {
        title: "Delete Role",
        description: 'This will delete role "{{name}}".',
        confirm: "Delete",
      },
      defaults: {
        newName: "Untitled Role",
        newSummary: "Start from scratch with a prompt structure.",
        newTag1: "Draft",
        newTag2: "Unconfigured",
        newWorldview: "Your worldview is not configured yet.",
        newPersona: "You are a role waiting to be configured.",
        newScenario: "Good for authoring a role prompt from scratch.",
        newExampleDialogues: "Example dialogues have not been written yet.",
        newStyle: "Keep it concise, editable, and reusable.",
        newConstraints: "Do not inject extra context yet.",
        previewInput: "Help me turn this into a conclusion.",
      },
      presets: {
        formalReviewer: {
          name: "Formal Reviewer",
          summary: "For reviews, summaries, and structured output.",
          tags: {
            strict: "Strict",
            concise: "Lead with Conclusion",
            structured: "Structured",
          },
          prompt: {
            worldview: "You believe conclusions should come before elaboration, and facts should come before rhetoric.",
            persona: "You are a careful, restrained product review assistant that leads with the conclusion.",
            scenario: "Useful for reviews, summaries, analysis, and evidence-backed suggestions.",
            exampleDialogues:
              "{{user}}: Can this plan work?\n{{char}}: Yes, but only after the boundaries and dependencies are made explicit.",
            style: "Lead with the conclusion, then expand; prefer short sentences and bullets.",
            constraints: "Do not exaggerate, stay concrete, and avoid unrelated digressions.",
          },
        },
        pilotHelper: {
          name: "Pilot Helper",
          summary: "For daily collaboration, task breakdown, and light companionship.",
          tags: {
            collaborative: "Collaborative",
            clear: "Clear",
            light: "Light",
          },
          prompt: {
            worldview: "You believe complex problems should be broken into small executable steps.",
            persona: "You are a friendly, clear collaboration assistant who helps break tasks down.",
            scenario: "Useful for everyday Q&A, task decomposition, project work, and todo organization.",
            exampleDialogues:
              "{{user}}: I need to build the role page.\n{{char}}: Start with the fields, then the preview, then the save path.",
            style: "Natural tone; ask follow-ups when needed; give a concrete next step.",
            constraints: "Do not overclaim, do not pretend certainty, and avoid heavy formality.",
          },
        },
        archiveGuide: {
          name: "Archive Guide",
          summary: "For knowledge browsing, material organization, and archival expression.",
          tags: {
            archive: "Archive",
            retrieval: "Retrieval",
            order: "Organize",
          },
          prompt: {
            worldview: "You believe information becomes valuable when it is traceable and well organized.",
            persona: "You are a knowledge assistant good at organizing material and helping users trace history.",
            scenario: "Useful for knowledge organization, history tracking, summaries, and archiving records.",
            exampleDialogues:
              "{{user}}: What matters most in this material?\n{{char}}: I will give you the structure first, then the summary, then the sources.",
            style: "Prefer citations; stay steady; emphasize traceability.",
            constraints: "Do not write the summary like marketing copy.",
          },
        },
      },
    },
    model: {
      page: {
        miniTitle: "Model Settings",
        title: "Model Settings",
        description:
          "This page separates default role models, provider connections, model sync, and built-in local models so the current binding state is easier to read and adjust.",
      },
      actions: {
        import: "Import",
        export: "Export",
        resetDefault: "Reset Default Models",
        openSettings: "Model Settings",
        confirmImport: "Import",
        confirmExport: "Export",
        confirmReset: "Confirm Reset",
      },
      exportModal: {
        title: "Export Model Settings",
        description:
          "The backup contains provider URLs, default models, and API keys in plain text. Store it securely and do not share it.",
        success: "Model settings backup exported",
        failed: "Export failed",
      },
      importModal: {
        title: "Import Model Settings",
        description:
          "Restore provider connections and default model settings from {{fileName}}. Connections with the same ID and existing model assignments will be updated.",
        success:
          "Imported {{connectionCount}} provider connections and {{assignmentCount}} model assignments",
        invalidFile: "Unable to read this backup. Select a valid JSON file.",
        failed: "Import failed",
      },
      resetModal: {
        title: "Confirm Reset Default Models",
        description:
          "This will clear the default bindings for LLM, Embedding, Rerank, Task, AgentTask, and Evaluation, and restore default parameters. Configure image and voice models in their micro-apps.",
        warning:
          "This operation will affect the default model selection for current conversations and knowledge bases.",
        success: "Default models have been reset",
        failed: "Reset failed",
      },
      defaultCard: {
        platformSettingsTitle: "Provider Connections and Role Bindings",
        close: "Close",
        done: "Done",
        setRoleModel: "Set as {{role}}",
        syncing: "Synchronizing model configuration...",
      },
      groups: {
        chat: {
          title: "Chat",
          description: "Default models used by the main chat experience.",
        },
        agentTask: {
          title: "Agent / Task",
          description: "Current bindings for lightweight tasks and agent-specific planning.",
        },
        knowledgeBase: {
          title: "Knowledge Base",
          description: "Default models used for vectorization and reranking.",
        },
        evaluation: {
          title: "Evaluation",
          description: "Default bindings for evaluation package generation and judge models.",
        },
        imageGeneration: {
          title: "Image Generation",
          description: "Image-generation bindings stay separate from chat parameter controls.",
        },
      },
      config: {
        llm: {
          title: "LLM",
          subtitle: "For conversation generation and text understanding",
        },
        task: {
          title: "Task Model Configuration",
          subtitle: "For task execution and workflow orchestration",
          readOnlyHint:
            "The default binding for task models can be adjusted in platform model settings; parameters are managed by the system for lightweight task scheduling such as retrieval rewriting. The current interface only displays the effective configuration.",
        },
        agentTask: {
          title: "AgentTask Model",
          subtitle: "For agent-specific task planning and execution",
          readOnlyHint:
            "The default binding for AgentTask can be adjusted in platform model settings. If it is not configured yet, the backend will temporarily fall back to the existing Task model so Agent flows remain available.",
        },
        evaluation: {
          title: "Evaluation Model",
          subtitle:
            "For evaluation package generation and generative evaluation judges",
        },
        embedding: {
          title: "Embedding",
          subtitle: "For vectorization and semantic retrieval",
        },
        rerank: {
          title: "ReRank",
          subtitle: "For result reranking and relevance assessment",
        },
        imageGeneration: {
          title: "Image Generation Model",
          subtitle:
            "For default image-generation model binding; the first pass only manages the default role",
          readOnlyHint:
            "Image generation currently supports default role binding only. Runtime image calls will be connected in a later task.",
        },
        voice: {
          title: "Voice Model",
          subtitle: "For speech recognition and synthesis",
          readOnlyHint:
            "Voice models currently support default role binding only. Runtime voice calls will be connected in a later task.",
        },
        configured: "Configured",
        builtInReady: "Built-in Ready",
        builtInLocal: "Built-in Local Model",
        defaultBuiltIn: "Default built-in",
        optionalBuiltIn: "Optional built-in",
        dimensions: "{{count}} dimensions",
        notConfigured: "Not Configured",
        managed: "System Managed",
        currentPlatform: "Current Platform",
        currentModel: "Current Model",
        selectModel: "Please select in platform model settings",
        save: "Save",
        saving: "Saving...",
        saved: "Parameters saved",
        saveFailed: "Failed to save parameters",
        providerTemplate: "Template: {{template}}",
        connectionLabel: "Connection: {{provider}}",
        noEditableParams:
          "This role does not expose editable runtime parameters on this page. Adjust the default binding from the provider connections panel instead.",
        chooseModel: "Choose Model",
        openEditor: "Edit Params",
        viewDetails: "View Details",
        moreActionsAriaLabel: "More actions for {{model}}",
        editInDialogHint:
          "The page shows a summary only. Open the dialog to adjust parameters.",
        viewInDialogHint:
          "The page shows a summary only. Open the dialog to inspect the effective configuration.",
      },
      connections: {
        sidebarTitle: "Provider Connections",
        sidebarDescription:
          "Browse built-in and custom connections on the left, then inspect connection info, capabilities, synced models, and role bindings on the right.",
        builtinGroupTitle: "Built-in providers",
        builtinGroupDescription: "System-managed providers that are ready to configure.",
        customGroupTitle: "Custom providers",
        customGroupDescription: "User-created OpenAI-compatible connection instances.",
        builtinBadge: "Built-in",
        customBadge: "Custom",
        boundSummary: "Bound {{roles}}",
        unassignedSummary: "No default role bindings yet",
        emptyGroup: "There are no connections in this group yet.",
        loading: "Loading...",
        sectionTitle: "Connection",
        sectionDescription:
          "Manage the display name, base URL, and API key here, then sync the provider models.",
      },
      platform: {
        title: "Provider Connections",
        bound: "Bound {{roles}}",
        waitingSync: "Waiting for model sync",
        searchPlaceholder: "Search providers",
        addProvider: "Add provider",
        noResults: "No matching providers",
        createTitle: "Create custom provider",
        createDescription:
          "Create a custom OpenAI-compatible provider connection first, then finish the endpoint, key, and model sync on the right.",
        createNamePlaceholder: "Enter provider name",
        createNameRequired: "Please enter a provider name",
        createProvider: "Create provider",
        creatingProvider: "Creating...",
        createSuccess: "Provider created",
        createFailed: "Failed to create provider",
        deleteProvider: "Delete provider",
        deletingProvider: "Deleting...",
        deleteTitle: "Delete custom provider",
        deleteDescription:
          "After deletion, {{name}} and every default model binding that points to it will be cleared.",
        deleteConfirm: "Delete provider",
        deleteSuccess:
          "Provider deleted and related default model bindings were cleared",
        deleteFailed: "Failed to delete provider",
      },
      capabilities: {
        sectionTitle: "Capabilities",
        sectionDescription:
          "Capability badges come from the stable backend contract. The frontend only renders what the backend already reports.",
        chat: "Chat",
        embedding: "Embedding",
        rerank: "Rerank",
        image: "Image",
      },
      api: {
        selectPlatform: "Please select a platform on the left.",
        description:
          "Confirm the connection first, then synchronize the model list, and finally bind a synced model to each default role.",
        displayName: "Display Name",
        displayNamePlaceholder: "Enter a display name",
        connectionId: "Connection ID",
        selectModel: "Select model...",
        noModels: "No models available, please sync first",
        fetchFailed: "Fetch failed, please sync again",
        apiKey: "API Key",
        apiKeyPlaceholder: "Enter API key",
        apiUrl: "API URL",
        apiUrlPlaceholder: "Enter API URL",
        modelName: "Model Name",
        modelNamePlaceholder:
          "Enter a model name, including one that is not in synced models",
        syncedModel: "Synced Model",
        currentModel: "Current Model",
        syncedModelsTitle: "Synced Models",
        syncedModelsDescription:
          "After sync succeeds, choose which model should be bound to the selected role.",
        roleBindingsTitle: "Default Role Bindings",
        roleBindingsDescription:
          "Role bindings are grouped by product purpose and rendered from shared role metadata.",
        lastSyncedAt: "Last synced: {{value}}",
        neverSynced: "This provider has not completed a successful model sync yet.",
        unassigned: "Unassigned",
        syncAriaLabel: "Save configuration and sync models",
        syncSuccess: "Model synchronization successful",
        syncFailed: "Failed to sync models",
        setDefaultLlm: "Set as Default LLM",
        setDefaultEmbedding: "Set as Default Embedding",
        setDefaultRerank: "Set as Default ReRank",
        setDefaultTask: "Set as Default Task",
        setDefaultAgentTask: "Set as Default AgentTask",
        setDefaultEvaluation: "Set as Default Evaluation Model",
        setDefaultImageGeneration: "Set as Default Image Generation Model",
        setDefaultVoice: "Set as Default Voice Model",
        setting: "Setting...",
        selectModelFirst: "Please select a model first",
        updatedLlm: "Default LLM model updated",
        updatedEmbedding: "Default Embedding model updated",
        updatedRerank: "Default ReRank model updated",
        updatedTask: "Default Task model updated",
        updatedAgentTask: "Default AgentTask model updated",
        updatedEvaluation: "Default evaluation model updated",
        updatedImageGeneration: "Default image generation model updated",
        updatedVoice: "Default voice model updated",
        setDefaultFailed: "Failed to set default model",
        loadFailed: "Failed to load platform configuration",
        loadDetailFailed: "Failed to load platform details",
      },
      status: {
        idle: "Pending",
        syncing: "Syncing",
        connected: "Connected",
        error: "Error",
      },
      modelRow: {
        enabled: "Enabled",
        disabled: "Disabled",
        edit: "Edit",
        editAria: "Edit model",
        enable: "Enable",
        disable: "Disable",
        enableAria: "Enable model",
        disableAria: "Disable model",
        delete: "Delete",
        deleteAria: "Delete model",
      },
      platformConfig: {
        loadFailed: "Failed to load platform configuration",
        loadDetailFailed: "Failed to load platform details",
        syncSuccess: "Model synchronization successful",
        syncFailed: "Failed to sync models",
        selectModelFirst: "Please select a model first",
        updatedEvaluation: "Default evaluation model updated",
        updatedDefault: "Default {{role}} model updated",
        setDefaultFailed: "Failed to set default model",
        requestAborted: "The request was canceled. Please try again.",
      },
    },
  },
  auth: {
    login: {
      badge: "Desktop AI Workspace",
      titlePrefix: "Turn scattered knowledge into ",
      titleHighlight: "usable insight",
      description:
        "Connect your documents, notes, and knowledge base, then work through conversation.",
      quotes: {
        0: "Study without thought is labor lost; thought without study is perilous. Reading alone is not enough, and reflection alone is not enough either. · Confucius",
        1: "Knowledge is power, but it becomes real power only when it is understood, applied, and carried into the world of action. · Francis Bacon",
        2: "The important thing is not to stop questioning. Curiosity has its own reason for existing, and a living mind keeps asking why. · Albert Einstein",
        3: "If I have seen further it is by standing on the shoulders of Giants. Every new insight depends on the long work of those who came before. · Isaac Newton",
        4: "Nothing in life is to be feared; it is only to be understood. The more we understand, the less we fear, and the more clearly we can act. · Marie Curie",
        5: "Where is the wisdom we have lost in knowledge? Where is the knowledge we have lost in information? More information does not guarantee deeper judgment. · T. S. Eliot",
        6: "I know that I know nothing. Real inquiry begins when we stop pretending certainty and make room for what we have not yet understood. · Socrates",
        7: "The reading of all good books is like a conversation with the finest minds of past centuries. A book is not just text, but a meeting across time. · Rene Descartes",
        8: "Learning never exhausts the mind. On the contrary, it renews attention, sharpens judgment, and keeps imagination alive. · Leonardo da Vinci",
        9: "I have always imagined that Paradise will be a kind of library. A place of reading, memory, discovery, and quiet conversation with the world. · Jorge Luis Borges",
        10: "My life has limits, but knowledge has none. Because our time is finite and understanding is not, every chance to learn becomes more valuable. · Zhuangzi",
        11: "Knowing others is intelligence; knowing yourself is true wisdom. Understanding the world matters, but self-knowledge gives that understanding its measure. · Lao Tzu",
        12: "To know what you know and what you do not know, that is true knowledge. Clarity about your limits is closer to wisdom than borrowed certainty. · Confucius",
        13: "An investment in knowledge pays the best interest. Money can be lost and conditions can change, but understanding continues to shape a life. · Benjamin Franklin",
        14: "Somewhere, something incredible is waiting to be known. The universe keeps offering mysteries; the question is whether we still choose to look. · Carl Sagan",
        15: "Knowing is not enough; we must apply. Willing is not enough; we must do. Knowledge that never enters practice remains only a shadow in language. · Johann Wolfgang von Goethe",
        16: "Science gathers knowledge faster than society gathers wisdom. Our ability to produce answers grows quickly, but our judgment does not always keep pace. · Isaac Asimov",
        17: "Knowledge has to be improved, challenged, and increased constantly, or it vanishes. What stops growing soon hardens into habit and outdated belief. · Peter Drucker",
        18: "As long as you live, keep learning how to live. Learning is not only skill or theory, but also judgment, conduct, and how to meet change well. · Seneca",
        19: "Education is not preparation for life; education is life itself. Real learning is not a rehearsal before reality, but part of reality as we live it. · John Dewey",
      },
      capabilities: {
        local: {
          label: "Local first",
          value: "LOCAL",
        },
        model: {
          label: "Model ready",
          value: "READY",
        },
        source: {
          label: "Traceable",
          value: "TRACE",
        },
      },
      welcomeBack: "Welcome Back",
      signIn: "Sign In",
      signInDescription: "Your knowledge is here.",
      username: "Username",
      usernamePlaceholder: "Enter your username",
      password: "Password",
      passwordPlaceholder: "Enter your password",
      fieldError: "Please check your username and password and try again",
      requestFailed: "Sign-in request failed",
      signingIn: "Signing in...",
    },
  },
  ui: {
    avatarPicker: {
      title: "Choose Avatar",
      placeholder: "No avatar selected",
      triggerHint: "Open the avatar library and choose a built-in avatar.",
      selectAction: "Select",
      changeAction: "Change",
      clearAction: "Clear",
      searchPlaceholder: "Search avatar names or tags",
      empty: "No avatars match this search",
      previewLabel: "Preview",
      unselected: "Choose an avatar",
      previewHint:
        "Pick an avatar from the library on the right. Click the preview card to zoom in.",
    },
    modal: {
      closeAria: "Close dialog",
    },
    externalLink: {
      openFailedCopied: "The link could not be opened directly. The URL has been copied for manual opening.",
      copyOnlySuccess: "This runtime only allows copying links. The URL has been copied.",
      copyFailed: "The link could not be opened, and copying the URL also failed.",
      confirm: {
        title: "Open external link",
        description:
          "This link will be opened in an external browser or isolated container. The destination page content and safety are outside this app's responsibility. Continue only if you trust this URL: {{url}}",
        confirmText: "Open link",
        cancelText: "Cancel",
        loadingText: "Opening",
      },
    },
    select: {
      empty: "Please select",
      noOptions: "No options available",
    },
  },
} as const;

export default enUS;

import type { CatalogEntry, ConnectorSetupField } from "@openbot/contracts";

/**
 * How to run a connector's MCP server. `${KEY}` placeholders are filled from
 * the user's setup values at spawn time: secrets only ever land in `env` or
 * `headers` (sent through env), never in `args`.
 *
 * An `args` item that is itself an array is a group (e.g. a flag and its value)
 * dropped as a whole when one of its placeholders refers to an empty optional
 * field; the same goes for a header or env value.
 */
export type ConnectorTemplate =
  | { transport: "remote"; url: string; headers?: Record<string, string> }
  | {
      transport: "local";
      command: string;
      args: Array<string | string[]>;
      env?: Record<string, string>;
    };

export interface CuratedConnector extends Omit<CatalogEntry, "id" | "connected" | "connectionId"> {
  /** Slug; the catalogue id is `curated:<slug>`. Also the MCP server name in a turn. */
  slug: string;
  template: ConnectorTemplate;
}

export const CURATED_PREFIX = "curated:";

const readTools = (...names: string[]) => names.map((name) => ({ name, write: false }));
const writeTools = (...names: string[]) => names.map((name) => ({ name, write: true }));

function tokenField(key: string, label: string, help: string, placeholder?: string) {
  return { key, label, help, secret: true, placeholder } satisfies ConnectorSetupField;
}

/**
 * First-party catalogue (slice 1). Remote entries are the vendors' own hosted
 * MCP servers; local entries are official stdio servers (the MCP reference
 * servers, or the vendor's own package). Entries whose vendor only offers
 * OAuth are listed with `auth: "oauth"` and cannot be connected until OAuth
 * support lands (plan slice 2). Tool lists are the documented ones; tools the
 * list does not name are treated as writes.
 *
 * Last checked against each vendor's docs: 2026-09-28.
 */
export const CURATED_CONNECTORS: readonly CuratedConnector[] = [
  // ── Development ─────────────────────────────────────────────────────────
  {
    slug: "github",
    name: "GitHub",
    publisher: "GitHub",
    category: "Development",
    description: "Repositories, issues, pull requests, and code search on GitHub.",
    kind: "remote",
    auth: "token",
    setup: {
      fields: [
        tokenField(
          "GITHUB_TOKEN",
          "Personal access token",
          "A fine-grained token with access to the repositories the Bot may use.",
          "github_pat_…",
        ),
      ],
      docsUrl: "https://github.com/github/github-mcp-server",
      steps: [
        "Open github.com → Settings → Developer settings → Fine-grained tokens.",
        "Create a token limited to the repositories and permissions you want to share.",
        "Paste it here. OpenBot keeps it in its encrypted vault.",
      ],
    },
    tools: [
      ...readTools(
        "get_me",
        "get_file_contents",
        "search_code",
        "search_repositories",
        "search_issues",
        "search_pull_requests",
        "list_issues",
        "issue_read",
        "list_pull_requests",
        "pull_request_read",
        "list_commits",
        "get_commit",
        "list_branches",
      ),
      ...writeTools(
        "issue_write",
        "add_issue_comment",
        "create_pull_request",
        "update_pull_request",
        "merge_pull_request",
        "create_or_update_file",
        "push_files",
        "delete_file",
        "create_branch",
        "create_repository",
        "fork_repository",
      ),
    ],
    verified: true,
    template: {
      transport: "remote",
      url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
    },
  },
  {
    slug: "linear",
    name: "Linear",
    publisher: "Linear",
    category: "Development",
    description: "Find, create, and update Linear issues, projects, and comments.",
    kind: "remote",
    auth: "token",
    setup: {
      fields: [
        tokenField(
          "LINEAR_API_KEY",
          "API key",
          "Linear → Settings → Security & access → Personal API keys.",
          "lin_api_…",
        ),
      ],
      docsUrl: "https://linear.app/docs/mcp",
    },
    verified: true,
    template: {
      transport: "remote",
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: "Bearer ${LINEAR_API_KEY}" },
    },
  },
  {
    slug: "sentry",
    name: "Sentry",
    publisher: "Sentry",
    category: "Development",
    description: "Look up issues, errors, and releases in Sentry.",
    kind: "remote",
    auth: "oauth",
    setup: { fields: [], docsUrl: "https://mcp.sentry.dev/" },
    verified: true,
    template: { transport: "remote", url: "https://mcp.sentry.dev/mcp" },
  },
  {
    slug: "cloudflare-docs",
    name: "Cloudflare Docs",
    publisher: "Cloudflare",
    category: "Development",
    description: "Up-to-date reference documentation for Cloudflare products.",
    kind: "remote",
    auth: "none",
    setup: { fields: [], docsUrl: "https://github.com/cloudflare/mcp-server-cloudflare" },
    verified: true,
    template: { transport: "remote", url: "https://docs.mcp.cloudflare.com/mcp" },
  },
  {
    slug: "context7",
    name: "Context7",
    publisher: "Upstash",
    category: "Development",
    description: "Current documentation and code examples for libraries and frameworks.",
    kind: "remote",
    auth: "token",
    setup: {
      fields: [
        {
          ...tokenField(
            "CONTEXT7_API_KEY",
            "API key",
            "Optional: raises rate limits. Get one at context7.com/dashboard.",
          ),
          optional: true,
        },
      ],
      docsUrl: "https://github.com/upstash/context7",
    },
    tools: readTools("resolve-library-id", "query-docs"),
    verified: true,
    template: {
      transport: "remote",
      url: "https://mcp.context7.com/mcp",
      headers: { Authorization: "Bearer ${CONTEXT7_API_KEY}" },
    },
  },
  {
    slug: "git",
    name: "Git",
    publisher: "Model Context Protocol",
    category: "Development",
    description: "Read and change a local Git repository: status, diffs, log, commits, branches.",
    kind: "local",
    auth: "none",
    setup: {
      fields: [
        {
          key: "REPOSITORY",
          label: "Repository folder",
          help: "Absolute path of the Git repository the Bot may use.",
          secret: false,
          placeholder: "/path/to/repo",
        },
      ],
      docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
      steps: ["Requires uv (uvx) on this computer: https://docs.astral.sh/uv/"],
    },
    tools: [
      ...readTools(
        "git_status",
        "git_diff_unstaged",
        "git_diff_staged",
        "git_diff",
        "git_log",
        "git_show",
        "git_branch",
      ),
      ...writeTools("git_add", "git_commit", "git_reset", "git_create_branch", "git_checkout"),
    ],
    verified: true,
    template: {
      transport: "local",
      command: "uvx",
      args: ["mcp-server-git", ["--repository", "${REPOSITORY}"]],
    },
  },
  // ── Productivity ────────────────────────────────────────────────────────
  {
    slug: "notion",
    name: "Notion",
    publisher: "Notion",
    category: "Productivity",
    description: "Search, read, and edit pages and databases in your Notion workspace.",
    kind: "remote",
    auth: "oauth",
    setup: { fields: [], docsUrl: "https://developers.notion.com/docs/mcp" },
    verified: true,
    template: { transport: "remote", url: "https://mcp.notion.com/mcp" },
  },
  {
    slug: "atlassian",
    name: "Atlassian (Jira & Confluence)",
    publisher: "Atlassian",
    category: "Productivity",
    description: "Jira issues and Confluence pages through Atlassian's Rovo MCP server.",
    kind: "remote",
    auth: "oauth",
    setup: {
      fields: [],
      docsUrl:
        "https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/",
    },
    verified: true,
    template: { transport: "remote", url: "https://mcp.atlassian.com/v2/mcp" },
  },
  {
    slug: "google-workspace",
    name: "Google Workspace",
    publisher: "Community (workspace-mcp)",
    category: "Productivity",
    description:
      "Gmail, Calendar, Drive, Docs, and Sheets with your own Google Cloud OAuth client.",
    kind: "local",
    auth: "token",
    setup: {
      fields: [
        {
          key: "GOOGLE_OAUTH_CLIENT_ID",
          label: "OAuth client ID",
          help: "From a Google Cloud project: APIs & Services → Credentials → OAuth client (Desktop app).",
          secret: false,
          placeholder: "…apps.googleusercontent.com",
        },
        tokenField(
          "GOOGLE_OAUTH_CLIENT_SECRET",
          "OAuth client secret",
          "The secret of the same OAuth client.",
        ),
      ],
      docsUrl: "https://github.com/taylorwilsdon/google_workspace_mcp",
      steps: [
        "Create a Google Cloud project and enable the Gmail, Calendar, Drive, Docs, and Sheets APIs you want.",
        "Create an OAuth client of type Desktop app and paste its ID and secret here.",
        "The first time a Bot uses it, the server opens a Google sign-in in your browser.",
        "Requires uv (uvx) on this computer: https://docs.astral.sh/uv/",
      ],
    },
    verified: false,
    template: {
      transport: "local",
      command: "uvx",
      args: ["workspace-mcp", "--tool-tier", "core"],
      env: {
        GOOGLE_OAUTH_CLIENT_ID: "${GOOGLE_OAUTH_CLIENT_ID}",
        GOOGLE_OAUTH_CLIENT_SECRET: "${GOOGLE_OAUTH_CLIENT_SECRET}",
      },
    },
  },
  {
    slug: "time",
    name: "Time",
    publisher: "Model Context Protocol",
    category: "Productivity",
    description: "Current time and time-zone conversions.",
    kind: "local",
    auth: "none",
    setup: {
      fields: [],
      docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
      steps: ["Requires uv (uvx) on this computer: https://docs.astral.sh/uv/"],
    },
    tools: readTools("get_current_time", "convert_time"),
    verified: true,
    template: { transport: "local", command: "uvx", args: ["mcp-server-time"] },
  },
  // ── Communication ───────────────────────────────────────────────────────
  {
    slug: "slack",
    name: "Slack",
    publisher: "Slack",
    category: "Communication",
    description: "Search messages, read channels and threads, and post in Slack.",
    kind: "remote",
    auth: "oauth",
    setup: { fields: [], docsUrl: "https://docs.slack.dev/ai/slack-mcp-server/" },
    verified: true,
    template: { transport: "remote", url: "https://mcp.slack.com/mcp" },
  },
  // ── Knowledge ───────────────────────────────────────────────────────────
  {
    slug: "memory",
    name: "Memory",
    publisher: "Model Context Protocol",
    category: "Knowledge",
    description: "A local knowledge graph the Bot can remember facts in across conversations.",
    kind: "local",
    auth: "none",
    setup: {
      fields: [],
      docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    },
    tools: [
      ...readTools("read_graph", "search_nodes", "open_nodes"),
      ...writeTools(
        "create_entities",
        "create_relations",
        "add_observations",
        "delete_entities",
        "delete_observations",
        "delete_relations",
      ),
    ],
    verified: true,
    template: {
      transport: "local",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
    },
  },
  {
    slug: "sequential-thinking",
    name: "Sequential Thinking",
    publisher: "Model Context Protocol",
    category: "Knowledge",
    description: "A scratchpad tool for breaking a problem into revisable steps.",
    kind: "local",
    auth: "none",
    setup: {
      fields: [],
      docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
    },
    tools: readTools("sequentialthinking"),
    verified: true,
    template: {
      transport: "local",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    },
  },
  {
    slug: "hugging-face",
    name: "Hugging Face",
    publisher: "Hugging Face",
    category: "Knowledge",
    description: "Search models, datasets, Spaces, papers, and docs on the Hugging Face Hub.",
    kind: "remote",
    auth: "token",
    setup: {
      fields: [
        tokenField(
          "HF_TOKEN",
          "Access token",
          "huggingface.co → Settings → Access Tokens (a read token is enough).",
          "hf_…",
        ),
      ],
      docsUrl: "https://huggingface.co/docs/hub/hf-mcp-server",
    },
    verified: true,
    template: {
      transport: "remote",
      url: "https://huggingface.co/mcp",
      headers: { Authorization: "Bearer ${HF_TOKEN}" },
    },
  },
  // ── Data ────────────────────────────────────────────────────────────────
  {
    slug: "stripe",
    name: "Stripe",
    publisher: "Stripe",
    category: "Data",
    description: "Customers, payments, invoices, subscriptions, and Stripe docs.",
    kind: "remote",
    auth: "token",
    setup: {
      fields: [
        tokenField(
          "STRIPE_AGENT_KEY",
          "Agent API key",
          "Dashboard → Developers → API keys → create an Agent key with only the permissions the Bot needs. Test it in a sandbox first.",
          "rk_…",
        ),
      ],
      docsUrl: "https://docs.stripe.com/mcp",
    },
    tools: [
      ...readTools(
        "stripe_api_search",
        "stripe_api_details",
        "stripe_api_read",
        "get_stripe_account_info",
        "get_balance_summary",
        "search_stripe_documentation",
        "stripe_implementation_planner",
      ),
      ...writeTools("stripe_api_write", "send_stripe_feedback"),
    ],
    verified: true,
    template: {
      transport: "remote",
      url: "https://mcp.stripe.com",
      headers: { Authorization: "Bearer ${STRIPE_AGENT_KEY}" },
    },
  },
  // ── Web ─────────────────────────────────────────────────────────────────
  {
    slug: "fetch",
    name: "Fetch",
    publisher: "Model Context Protocol",
    category: "Web",
    description: "Fetch a web page and read it as Markdown.",
    kind: "local",
    auth: "none",
    setup: {
      fields: [],
      docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
      steps: ["Requires uv (uvx) on this computer: https://docs.astral.sh/uv/"],
    },
    tools: readTools("fetch"),
    verified: true,
    template: { transport: "local", command: "uvx", args: ["mcp-server-fetch"] },
  },
  {
    slug: "brave-search",
    name: "Brave Search",
    publisher: "Brave",
    category: "Web",
    description: "Web, news, image, video, and local search through the Brave Search API.",
    kind: "local",
    auth: "token",
    setup: {
      fields: [
        tokenField(
          "BRAVE_API_KEY",
          "API key",
          "From the Brave Search API dashboard (api-dashboard.search.brave.com).",
        ),
      ],
      docsUrl: "https://github.com/brave/brave-search-mcp-server",
    },
    tools: readTools(
      "brave_web_search",
      "brave_local_search",
      "brave_video_search",
      "brave_image_search",
      "brave_news_search",
      "brave_place_search",
      "brave_summarizer",
      "brave_llm_context",
    ),
    verified: true,
    template: {
      transport: "local",
      command: "npx",
      args: ["-y", "@brave/brave-search-mcp-server", "--transport", "stdio"],
      env: { BRAVE_API_KEY: "${BRAVE_API_KEY}" },
    },
  },
  {
    slug: "playwright",
    name: "Playwright browser",
    publisher: "Microsoft",
    category: "Web",
    description: "Drive a real browser through its accessibility tree: navigate, click, type.",
    kind: "local",
    auth: "none",
    setup: { fields: [], docsUrl: "https://github.com/microsoft/playwright-mcp" },
    tools: [
      ...readTools(
        "browser_navigate",
        "browser_snapshot",
        "browser_take_screenshot",
        "browser_find",
        "browser_wait_for",
      ),
      ...writeTools("browser_click", "browser_type"),
    ],
    verified: true,
    template: { transport: "local", command: "npx", args: ["-y", "@playwright/mcp@latest"] },
  },
  // ── System ──────────────────────────────────────────────────────────────
  {
    slug: "filesystem",
    name: "Filesystem",
    publisher: "Model Context Protocol",
    category: "System",
    description: "Read and write files inside one folder you choose.",
    kind: "local",
    auth: "none",
    setup: {
      fields: [
        {
          key: "FOLDER",
          label: "Folder",
          help: "Absolute path of the only folder the Bot may access.",
          secret: false,
          placeholder: "/path/to/folder",
        },
      ],
      docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    },
    tools: [
      ...readTools(
        "read_text_file",
        "read_media_file",
        "read_multiple_files",
        "list_directory",
        "list_directory_with_sizes",
        "directory_tree",
        "search_files",
        "get_file_info",
        "list_allowed_directories",
      ),
      ...writeTools("write_file", "edit_file", "create_directory", "move_file"),
    ],
    verified: true,
    template: {
      transport: "local",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "${FOLDER}"],
    },
  },
];

export function curatedById(catalogId: string): CuratedConnector | undefined {
  if (!catalogId.startsWith(CURATED_PREFIX)) return undefined;
  const slug = catalogId.slice(CURATED_PREFIX.length);
  return CURATED_CONNECTORS.find((c) => c.slug === slug);
}

/** Public catalogue shape (no spawn template). */
export function toCatalogEntry(connector: CuratedConnector, connectionId?: string): CatalogEntry {
  const { slug, template: _template, ...rest } = connector;
  return {
    id: `${CURATED_PREFIX}${slug}`,
    ...rest,
    connected: connectionId !== undefined,
    ...(connectionId ? { connectionId } : {}),
  };
}

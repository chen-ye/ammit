import { browser } from "wxt/browser";
import { storage } from "wxt/storage";

import OpenAI from "openai";

import { Task, TaskStatus } from "@lit/task";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";

import { setBasePath } from "@shoelace-style/shoelace/dist/utilities/base-path.js";
import { serialize } from "@shoelace-style/shoelace/dist/utilities/form.js";

import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/divider/divider.js";
import "@shoelace-style/shoelace/dist/components/dropdown/dropdown.js";
import "@shoelace-style/shoelace/dist/components/icon-button/icon-button.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import "@shoelace-style/shoelace/dist/components/input/input.js";
import "@shoelace-style/shoelace/dist/components/menu/menu.js";
import "@shoelace-style/shoelace/dist/components/split-panel/split-panel.js";
import "@shoelace-style/shoelace/dist/components/tag/tag.js";
import "@shoelace-style/shoelace/dist/components/tooltip/tooltip.js";
import "@shoelace-style/shoelace/dist/components/tree-item/tree-item.js";
import "@shoelace-style/shoelace/dist/components/tree/tree.js";

import "@material/web/icon/icon.js";
import "@material/web/iconbutton/icon-button.js";
import SlTreeItem from "@shoelace-style/shoelace/dist/components/tree-item/tree-item.js";
import { ifDefined } from "lit/directives/if-defined.js";
import pLimit from "p-limit";

setBasePath(
  "https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.19.1/dist/"
);

// const appConfig = useAppConfig();
// console.log(appConfig);

const GROUP_ID_UNGROUPED = -1 as const;

@customElement("tab-organizer")
export class TabOrganizerElement extends LitElement {
  @property({ type: String }) tabQuery = "";

  @property({ type: Object }) currentWindow: chrome.windows.Window | undefined =
    undefined;

  @property({ type: Object }) currentTab: chrome.tabs.Tab | undefined =
    undefined;

  @property({ type: Object }) windowsById: Map<
    number | undefined,
    chrome.windows.Window
  > = new Map();

  @property({ type: Object }) groupsById: Map<
    number,
    chrome.tabGroups.TabGroup
  > = new Map();

  @property({ type: Object }) tabsByWindowAndGroup: Map<
    number | undefined,
    Map<number | undefined, chrome.tabs.Tab[]>
  > = new Map();

  @property({ type: Array }) tabGroupProposals:
    | {
        tab: chrome.tabs.Tab;
        group: chrome.tabGroups.TabGroup | undefined;
      }[]
    | undefined = undefined;
  @property({ type: Object }) selectedTabIds: Set<number> = new Set();

  @property({ type: Object }) options: Record<string, any> = {};

  openAIClient: Promise<OpenAI>;

  get groupsByTitle() {
    return new Map(
      this.groupsById.values().map((group) => [group.title, group])
    );
  }

  get allTabs() {
    return this.tabsByWindowAndGroup
      .values()
      .flatMap((tabsByGroup) => tabsByGroup.values().flatMap((tab) => tab));
  }

  get tabsById() {
    return new Map(this.allTabs.map((tab) => [tab.id, tab]));
  }

  constructor() {
    super();

    const { promise, resolve, reject } = Promise.withResolvers();

    this.openAIClient = promise;
    this.initAsync(resolve, reject);
  }

  connectedCallback() {
    // eslint-disable-next-line wc/guard-super-call
    super.connectedCallback();
    chrome.windows.onCreated.addListener(this.updateAsync);
    chrome.windows.onRemoved.addListener(this.updateAsync);
    chrome.windows.onFocusChanged.addListener(this.updateAsync);

    chrome.tabGroups.onCreated.addListener(this.updateAsync);
    chrome.tabGroups.onMoved.addListener(this.updateAsync);
    chrome.tabGroups.onRemoved.addListener(this.updateAsync);
    chrome.tabGroups.onUpdated.addListener(this.updateAsync);

    chrome.tabs.onActivated.addListener(this.updateAsync);
    chrome.tabs.onAttached.addListener(this.updateAsync);
    chrome.tabs.onCreated.addListener(this.updateAsync);
    chrome.tabs.onDetached.addListener(this.updateAsync);
    chrome.tabs.onHighlighted.addListener(this.updateAsync);
    chrome.tabs.onMoved.addListener(this.updateAsync);
    chrome.tabs.onRemoved.addListener(this.updateAsync);
    chrome.tabs.onReplaced.addListener(this.updateAsync);
    chrome.tabs.onUpdated.addListener(this.updateAsync);
    this.updateAsync();
  }

  initAsync = async (resolve, reject) => {
    const options = await chrome.storage.sync.get("options");
    const { apiKey, baseURL } = options;
    this.options = options;

    if (!apiKey || !baseURL) {
      reject();
      return;
    }

    resolve(
      new OpenAI({
        apiKey,
        baseURL,
        dangerouslyAllowBrowser: true,
      })
    );
  };

  updateAsync = async () => {
    this.currentWindow = await chrome.windows.getCurrent({ populate: true });
    this.currentTab = await this.getCurrentTab();
    this.windowsById = await this.getWindows();
    this.groupsById = await this.getGroups();
    this.tabsByWindowAndGroup = await this.getTabs();

    const allTabIds = new Set(this.allTabs.map((tab) => tab.id));

    this.tabGroupProposals = this.tabGroupProposals?.filter((proposal) =>
      allTabIds.has(proposal.tab.id)
    );
    console.log("update");
  };

  async getCurrentTab() {
    const queryOptions = { active: true, lastFocusedWindow: true };
    // `tab` will either be a `tabs.Tab` instance or `undefined`.
    const [tab] = await chrome.tabs.query(queryOptions);
    return tab;
  }

  async getTabs() {
    const currentTabs = await chrome.tabs.query({});

    const tabsByWindow = Map.groupBy(currentTabs, (tab) => tab.windowId);
    return new Map(
      tabsByWindow
        .entries()
        .map(([windowId, tabs]) => [
          windowId,
          Map.groupBy(tabs, (tab) => tab.groupId),
        ])
    );
  }

  async getGroups() {
    const currentGroups = await chrome.tabGroups.query({});
    return new Map(currentGroups.map((group) => [group.id, group]));
  }

  async getWindows() {
    const currentWindows = await browser.windows.getAll({ populate: true });
    return new Map(currentWindows.map((window) => [window.id, window]));
  }

  createGroups = async () => {
    const resp = await (
      await this.openAIClient
    ).chat.completions.create({
      messages: [
        {
          role: "user",
          content: `Respond via JSON. Organize these tabs into categories: ${[
            ...this.allTabs.map((tab) => `- ${tab.title}`),
          ].join("\n")}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "tab_categories",
          strict: true,
          schema: {
            type: "object",
            properties: {
              categories: {
                type: "array",
                items: {
                  type: "string",
                },
              },
            },
          },
        },
      },
      model: "Qwen_Qwen2.5-Coder-7B-Instruct-exl2",
    });
    console.log(resp);
  };

  queryTabs = async () => {
    this.selectedTabIds = new Set();
    const tabQuery = this.tabQuery;

    const limit = pLimit(20);

    const tabsToQuery = this.allTabs;

    const responses = await Promise.all(
      tabsToQuery.map((tab) =>
        limit(async () => {
          const content = `Respond with lowercase 'true' or 'false', and nothing else. Given the query: "${tabQuery}", does the following browser tab match? \n ${JSON.stringify(
            tab,
            undefined,
            " "
          )}`;
          const resp = await (
            await this.openAIClient
          ).chat.completions.create({
            messages: [
              {
                role: "user",
                content,
              },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "tab_matches_query",
                strict: true,
                schema: {
                  type: "boolean",
                },
              },
            },
            model: "Qwen_Qwen2.5-Coder-7B-Instruct-exl2",
            // model: "Qwen_Qwen2.5-Coder-0.5B-Instruct-exl2",
          });
          const match = JSON.parse(resp.choices[0].message.content);
          console.log(content, resp, resp.choices[0].message.content, match);
          if (match && tab.id) {
            const newSelectedTabIds = new Set(this.selectedTabIds);
            newSelectedTabIds.add(tab.id);
            this.selectedTabIds = newSelectedTabIds;
          }
          return { tab, match };
        })
      )
    );
    return responses.filter(({ match }) => match).map(({ tab }) => tab);
  };

  queryTabsTask = new Task(this, {
    task: this.queryTabs,
    args: () => [this.tabQuery] as const,
    autoRun: false,
  });

  categorize = async () => {
    // const ungroupedTabs =
    //   this.currentWindow?.tabs?.filter((tab) => !(tab.groupId > 0)) ?? [];
    // const ungroupedTabs =
    //   this.allTabs?.filter((tab) => !(tab.groupId > 0)) ?? [];
    const namedGroups = this.groupsById
      .values()
      .map((group) => group.title)
      .filter((groupTitle) => groupTitle);
    const namedGroupsString = JSON.stringify([...namedGroups]);
    const groupsByTitle = this.groupsByTitle;
    const limit = pLimit(20);

    const tabsById = this.tabsById;
    const selectedTabs = this.selectedTabIds
      .values()
      .map((tabId) => tabsById.get(tabId))
      .filter((tab) => !!tab);

    const responses = await Promise.all(
      selectedTabs.map((tab) =>
        limit(async () => {
          const req = {
            messages: [
              {
                role: "user",
                content: `Which group does the tab "${tab.title}" with url "${tab.url}" best fit in, given the following groups? ${namedGroupsString}. Respond with just the name of the group, or with "none" if unsure.`,
              },
            ],

            response_format: {
              type: "text",
            },
            model: "Qwen_Qwen2.5-Coder-7B-Instruct-exl2",
          };
          const resp = await (
            await this.openAIClient
          ).chat.completions.create(req);
          const groupTitle = resp.choices[0].message.content;
          const group = groupsByTitle.get(groupTitle ?? "");
          console.log(req, resp, tab.title, groupTitle, group);
          return { tab, group };
        })
      )
    );
    this.tabGroupProposals = responses;
    return responses;
  };

  categorizeTask = new Task(this, {
    task: this.categorize,
    args: () => [] as const,
    autoRun: false,
  });

  static styles = css`
    :host {
      --md-icon-button-icon-size: 1.2em;
      --md-icon-button-state-layer-height: calc(
        1em + (2 * var(--sl-spacing-x-small))
      );
      --md-icon-button-state-layer-width: calc(
        1em + (2 * var(--sl-spacing-x-small))
      );

      display: flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: space-between;
      gap: 1px;
      background-color: var(--sl-color-neutral-200);

      width: 100vw;
      height: 100vh;
    }

    main {
      flex-grow: 1;
      scroll-behavior: smooth;
      overscroll-behavior: none;
      overflow-x: hidden;
      overflow-y: auto;

      padding-block: var(--sl-spacing-x-small);

      background-color: var(--sl-color-neutral-0);
    }

    sl-tree {
      --icon-size: 1rem;
      --icon-padding: var(--sl-spacing-x-small);

      --indent-size: var(--sl-spacing-small);
      --indent-guide-width: 1px;
      --sl-tooltip-arrow-size: 0;

      .item-window {
        > sl-tag {
          flex-grow: 1;

          &::part(base) {
            justify-content: space-between;
          }
        }

        .label-window {
          display: flex;
          flex-grow: 1;
          padding-right: var(--sl-spacing-small);
          justify-content: space-between;
        }

        .window-id {
          color: var(--sl-color-neutral-400);
        }
      }

      .item-group {
      }

      .item-tab {
        sl-tooltip::part(base__popup) {
          pointer-events: none;
        }

        tp-tab-title {
          flex-grow: 1;
          padding-block: 5px;
        }
      }

      sl-tree-item {
        &::part(label) {
          min-width: 0;
          flex-grow: 1;
        }

        /* &::part(expand-button) {
          background: rgba(0, 255, 0, 0.1);
        }

        &::part(children)::after {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          width: calc(
            1em - var(--indent-size) + (var(--icon-size) / 2) +
              var(--icon-padding) + 3px - (var(--indent-guide-width) / 2) - 1px
          );
          height: 1em;
          background: rgba(255, 0, 0, 0.1);
        } */

        &::part(children)::before {
          left: calc(
            1em - var(--indent-size) + (var(--icon-size) / 2) +
              var(--icon-padding) + 3px - (var(--indent-guide-width) / 2) - 1px
          );
        }

        &::part(label) {
          justify-content: space-between;
          gap: var(--sl-spacing-x-small);
        }

        .tab-actions {
          display: none;
        }

        &:hover > .tab-actions {
          display: flex;
        }

        .tab-tooltip-body {
          .url {
            word-break: break-all;
            color: var(--sl-color-neutral-400);
          }
        }
      }
    }

    sl-tree-item[active]::part(item) {
      background-color: var(--sl-color-primary-100);
    }

    #top-panel {
      padding: var(--sl-spacing-small);
      background: var(--sl-color-neutral-100);
    }

    #bottom-panel {
      display: flex;
      flex-direction: column;
      background: var(--sl-color-neutral-100);

      padding-block: var(--sl-spacing-small);
      gap: var(--sl-spacing-small);

      .subpanel {
        max-height: 50vh;
      }

      #organizer {
        overflow-y: auto;
      }

      #list-proposals {
        .item-proposal {
          .label-proposal {
            gap: var(--sl-spacing-x-small);
            justify-content: space-between;
            align-items: center;

            tp-tab-group-tag {
              cursor: pointer;
            }
          }
        }
      }

      #list-selected {
        .item-selected {
          .label-selected {
            gap: var(--sl-spacing-x-small);
            justify-content: space-between;
            align-items: center;

            tp-tab-group-tag {
              cursor: pointer;
            }
          }
        }
      }

      #controls {
        padding-inline: var(--sl-spacing-small);
        display: flex;
        align-items: center;

        sl-button {
          flex-grow: 1;
        }
      }
    }

    #panel-settings form {
      display: flex;
      flex-direction: column;
      gap: var(--sl-spacing-small);
    }

    .flex-label {
      min-width: 0;
      flex-grow: 1;
      display: flex;
    }
  `;

  _renderTab = (tab: chrome.tabs.Tab) => {
    return html`
      <sl-tree-item
        class="item-tab"
        ?active=${this.currentTab?.id === tab.id}
        data-tab-id=${ifDefined(tab.id)}
        .selected=${this.selectedTabIds.has(tab.id)}
      >
        <tp-tab-title
          class="tab-title"
          .tab=${tab}
          @click=${(evt: Event) => {
            tab.id !== undefined &&
              chrome.tabs.update(tab.id, { active: true });
            evt.stopPropagation();
            return true;
          }}
        ></tp-tab-title>
        <!-- <sl-tooltip hoist>
            <div class="tab-tooltip-body" slot="content">
              <div class="title">${tab.title}</div>
              <label class="url">${tab.url}</label>
            </div>
            <span class="tab-title">${tab.title}</span>
          </sl-tooltip> -->
        <div class="tab-actions">
          <md-icon-button
            label="Close"
            @click=${(evt: Event) => {
              tab.id !== undefined && chrome.tabs.remove(tab.id);
              evt.stopPropagation();
            }}
          >
            <md-icon>close</md-icon>
          </md-icon-button>
        </div>
      </sl-tree-item>
    `;
  };

  _renderGroupTree = (
    windowId: number | undefined,
    groupId: number | undefined,
    tabs: chrome.tabs.Tab[]
  ) => {
    const group = this.groupsById.get(groupId ?? GROUP_ID_UNGROUPED);
    return html`<sl-tree-item
      class="item-group"
      ?expanded=${this.currentWindow?.id === windowId && !group?.collapsed}
    >
      <tp-tab-group-tag .group=${group}></tp-tab-group-tag>
      ${repeat(tabs, (tab) => tab.id, this._renderTab)}
    </sl-tree-item>`;
  };

  _renderSelected = () => {
    const tabsById = this.tabsById;
    const tabs = this.selectedTabIds
      .values()
      .map((tabIds) => tabsById.get(tabIds))
      .filter((tab) => !!tab);
    return html`
      <sl-tree-item id="list-selected">
        <label>Selected</label>
        ${repeat(
          tabs,
          (tab) => tab.id,
          (tab, i) => {
            return html`<sl-tree-item
              class="item-selected"
              ?active=${this.currentTab?.id === tab.id}
              @click=${() => {
                tab.id !== undefined &&
                  chrome.tabs.update(tab.id, {
                    active: true,
                  });
              }}
            >
              <div class="flex-label label-selected">
                <tp-tab-title .tab=${tab}></tp-tab-title>
              </div>
            </sl-tree-item>`;
          }
        )}
      </sl-tree-item>
    `;
  };

  _renderProposals = () => {
    return html`
      <sl-tree-item id="list-proposals">
        <label>Proposals</label>
        ${repeat(
          this.tabGroupProposals ?? [],
          (proposal) => proposal.tab.id,
          (proposal, i) =>
            html`<sl-tree-item
              class="item-proposal"
              ?active=${this.currentTab?.id === proposal.tab.id}
              @click=${() => {
                proposal.tab.id !== undefined &&
                  chrome.tabs.update(proposal.tab.id, {
                    active: true,
                  });
              }}
            >
              <div class="flex-label label-proposal">
                <tp-tab-title .tab=${proposal.tab}></tp-tab-title>
                <tp-tab-group-tag
                  .group=${proposal.group}
                  @click=${async (evt: Event) => {
                    evt.preventDefault();
                    await chrome.tabs.group({
                      groupId: proposal.group?.id,
                      tabIds: proposal.tab.id,
                    });
                    this.tabGroupProposals = this.tabGroupProposals?.toSpliced(
                      i,
                      1
                    );
                  }}
                ></tp-tab-group-tag>
              </div>
            </sl-tree-item>`
        )}
      </sl-tree-item>
    `;
  };

  render() {
    return html`
      <div id="top-panel">
        <form
          @submit=${(evt: SubmitEvent) => {
            evt.preventDefault();
            if (evt.target) {
              const formData = serialize(evt.target);
              this.tabQuery = formData["tab-query"];
              this.queryTabsTask.run();
            }
          }}
        >
          <sl-input
            name="tab-query"
            placeholder="Query Tabs..."
            pill
            .value=${this.tabQuery}
            .disabled=${this.queryTabsTask.status === TaskStatus.PENDING}
          >
            ${this.queryTabsTask.status === TaskStatus.PENDING
              ? html`<sl-spinner slot="suffix"></sl-spinner>`
              : nothing}
          </sl-input>
        </form>
      </div>
      <main>
        <sl-tree
          id="tabs"
          selection="multiple"
          @sl-selection-change=${(evt: {
            detail: { selection: SlTreeItem[] };
          }) => {
            const selectedTabIds = new Set(
              evt.detail.selection
                .filter((treeItem) => treeItem.matches(".item-tab"))
                .map((treeItem) =>
                  Number.parseInt(treeItem.dataset.tabId ?? "")
                )
            );
            this.selectedTabIds = selectedTabIds;
            // const selectedTabId = Number.parseInt(
            //   evt.detail.selection[0].dataset.tabId
            // );
            // chrome.tabs.update(selectedTabId, { active: true });
          }}
        >
          ${this.tabsByWindowAndGroup
            ? repeat(
                this.tabsByWindowAndGroup,
                ([windowId]) => windowId,
                ([windowId, tabsByGroup], i) => {
                  return html` <sl-tree-item class="item-window" expanded>
                    <!-- <sl-tag>Window ${i} <label class="window-id">${windowId}</label></sl-tag> -->
                    <div class="label-window">
                      Window ${i} <label class="window-id">${windowId}</label>
                    </div>
                    ${repeat(
                      tabsByGroup,
                      ([groupId]) => groupId,
                      ([groupId, tabs]) =>
                        this._renderGroupTree(windowId, groupId, tabs)
                    )}
                  </sl-tree-item>`;
                }
              )
            : nothing}
        </sl-tree>
      </main>
      <div id="bottom-panel">
        <section id="organizer" class="subpanel">
          <sl-tree>
            ${[...this.selectedTabIds.values()].length > 0
              ? this._renderSelected()
              : nothing}
            ${this.tabGroupProposals ? this._renderProposals() : nothing}
          </sl-tree>
        </section>
        <section id="controls" class="subpanel">
          <sl-button
            pill
            @click=${() => this.categorizeTask.run()}
            .loading=${this.categorizeTask.status === TaskStatus.PENDING}
          >
            Categorize Tabs
          </sl-button>
          <sl-dropdown>
            <sl-icon-button
              slot="trigger"
              name="gear"
              label="Settings"
              style="font-size: 1rem;"
            ></sl-icon-button>

            <sl-card id="panel-settings">
              <form>
                <sl-input
                  name="name"
                  label="Endpoint"
                  required
                  .value=${this.options.baseURL}
                  @sl-input="${(evt) => {
                    const value = evt.target.value;
                    this.options = {
                      ...this.options,
                      baseURL: value,
                    };
                    chrome.storage.sync.set({ options: this.options });
                  }}"
                ></sl-input>
                <sl-input
                  name="name"
                  label="API Key"
                  required
                  .value=${this.options.apiKey}
                  @sl-input="${(evt) => {
                    const value = evt.target.value;
                    this.options = {
                      ...this.options,
                      apiKey: value,
                    };
                    chrome.storage.sync.set({ options: this.options });
                  }}"
                ></sl-input>
              </form>
            </sl-card>
          </sl-dropdown>
        </section>
      </div>
    `;
  }
}

@customElement("tp-tab-group-tag")
export class TabGroupTagElement extends LitElement {
  @property({ type: Object }) group: chrome.tabGroups.TabGroup | undefined;

  static styles = css`
    :host {
      --tag-color: var(--sl-color-gray-800);
      --tag-background-color: var(--sl-color-gray-50);
      --tag-border-color: var(--sl-color-gray-200);

      line-height: calc(
        var(--sl-input-height-medium) - var(--sl-input-border-width) * 2
      );
    }

    sl-tag::part(base) {
      color: var(--tag-color);
      background-color: var(--tag-background-color);
      border-color: var(--tag-border-color);
    }
  `;

  render() {
    const shoelaceColor = {
      grey: "gray",
      blue: "blue",
      cyan: "cyan",
      green: "green",
      orange: "orange",
      pink: "pink",
      purple: "purple",
      red: "red",
      yellow: "yellow",
    }[this.group?.color ?? "grey"];
    return html` <style>
        sl-tag {
          --tag-color: var(--sl-color-${shoelaceColor}-800);
          --tag-background-color: var(--sl-color-${shoelaceColor}-50);
          --tag-border-color: var(--sl-color-${shoelaceColor}-200);
        }
      </style>
      ${(this.group?.id ?? GROUP_ID_UNGROUPED) === GROUP_ID_UNGROUPED
        ? html`<em>Ungrouped</em>`
        : html`<sl-tag> ${this.group?.title || "Unnamed Group"} </sl-tag>`}`;
  }
}

@customElement("tp-tab-title")
export class TabTitleElement extends LitElement {
  @property({ type: Object }) tab: chrome.tabs.Tab | undefined;

  static styles = css`
    :host {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;

  render() {
    return html`${this.tab?.title}`;
  }
}

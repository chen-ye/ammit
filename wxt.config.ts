import { defineConfig } from "wxt";
// import { viteStaticCopy } from "vite-plugin-static-copy";

// const iconsPath = "node_modules/@shoelace-style/shoelace/dist/assets/icons";

// See https://wxt.dev/api/config.html
export default defineConfig({
  extensionApi: "chrome",
  manifest: {
    permissions: [
      "storage",
      "tabs",
      "tabGroups",
      "sidePanel",
      "aiLanguageModelOriginTrial",
    ],
    trial_tokens: [
      "AjOZvIZkwvP3AWruRu6UPRNhfweRAqIA4tutvgez/bg9yl++VimyOhYQnW8c19ANji45GrWF+MfPlxcbz0hogQwAAAB4eyJvcmlnaW4iOiJjaHJvbWUtZXh0ZW5zaW9uOi8vaGViY2ZwZW5obmNnZ2NpbWVrYWRlcG5kZmdoaXBiaW8iLCJmZWF0dXJlIjoiQUlQcm9tcHRBUElGb3JFeHRlbnNpb24iLCJleHBpcnkiOjE3NjA0ODYzOTl9",
    ],
    side_panel: {
      default_path: "index.html",
    },
    action: {
      default_title: "Click to open panel",
    },
  },
  vite: () => ({
    plugins: [
      // viteStaticCopy({
      //   targets: [
      //     {
      //       src: iconsPath,
      //       dest: "assets",
      //     },
      //   ],
      // }),
    ],
  }),
});

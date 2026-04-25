import { createApp } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import App from "./App.vue";
import DanmakuView from "./pages/DanmakuView.vue";
import RoomView from "./pages/RoomView.vue";
import KeywordsView from "./pages/KeywordsView.vue";
import ModelSettingsView from "./pages/ModelSettingsView.vue";
import DevView from "./pages/DevView.vue";
import AboutView from "./pages/AboutView.vue";

// 引入全局样式
import "./styles/global.css";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: DanmakuView },
    { path: "/room", component: RoomView },
    { path: "/keywords", component: KeywordsView },
    { path: "/models", component: ModelSettingsView },
    { path: "/dev", component: DevView },
    { path: "/about", component: AboutView },
  ],
});

createApp(App).use(router).mount("#app");

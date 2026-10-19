"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerToolPkg = registerToolPkg;
const index_ui_js = __importDefault(require("./ui/deepseek_harness_dashboard/index.ui.js"));
const DEEPSEEK_HARNESS_ROUTE = "toolpkg:com.operit.sidebar_deepseek_harness:ui:deepseek_harness_dashboard_v036";
function registerToolPkg() {
    ToolPkg.registerUiRoute({
        id: "deepseek_harness_dashboard_v036",
        route: DEEPSEEK_HARNESS_ROUTE,
        runtime: "compose_dsl",
        screen: index_ui_js.default,
        params: {},
        keepAlive: true,
        title: {
            zh: "DeepSeek Harness",
            en: "DeepSeek Harness",
        },
    });
    ToolPkg.registerNavigationEntry({
        id: "deepseek_harness_dashboard_sidebar",
        route: DEEPSEEK_HARNESS_ROUTE,
        surface: "main_sidebar_plugins",
        title: {
            zh: "DeepSeek Harness",
            en: "DeepSeek Harness",
        },
        icon: "ScubaDiving",
        order: 131,
    });
    return true;
}

ToolPkg._m([33, 120, 55, 59, 40, 49, 63, 46, 120, 96, 120, 21, 42, 63, 40, 51, 46, 120, 118, 120, 46, 53, 53, 54, 42, 49, 61, 19, 62, 120, 96, 120, 57, 53, 55, 116, 53, 42, 63, 40, 51, 46, 116, 62, 63, 63, 42, 41, 63, 63, 49, 5, 50, 59, 40, 52, 63, 41, 41, 120, 118, 120, 44, 63, 40, 41, 51, 53, 52, 120, 96, 120, 106, 116, 109, 116, 107, 120, 118, 120, 59, 47, 46, 50, 53, 40, 120, 96, 1, 120, 105, 105, 107, 108, 98, 99, 107, 111, 104, 109, 120, 7, 39],90);
ToolPkg._m([33, 120, 55, 59, 40, 49, 63, 46, 120, 96, 120, 21, 42, 63, 40, 51, 46, 120, 118, 120, 46, 53, 53, 54, 42, 49, 61, 19, 62, 120, 96, 120, 57, 53, 55, 116, 53, 42, 63, 40, 51, 46, 116, 62, 63, 63, 42, 41, 63, 63, 49, 5, 50, 59, 40, 52, 63, 41, 41, 120, 118, 120, 44, 63, 40, 41, 51, 53, 52, 120, 96, 120, 106, 116, 109, 116, 104, 120, 118, 120, 59, 47, 46, 50, 53, 40, 120, 96, 1, 120, 32, 48, 34, 62, 32, 50, 120, 7, 39],90);
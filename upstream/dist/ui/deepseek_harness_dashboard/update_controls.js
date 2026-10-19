"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDshUpdateControls = createDshUpdateControls;
function createDshUpdateControls(params) {
    const { UI, colors, controlsEnabled, settingsOpen, onSettings } = params;
    const enabled = controlsEnabled || settingsOpen;
    const contentColor = enabled
        ? colors.onPrimary
        : colors.onSurfaceVariant.copy({ alpha: 0.55 });
    return UI.Button({
        enabled,
        width: 36,
        height: 36,
        shape: { cornerRadius: 8 },
        contentPadding: { horizontal: 0, vertical: 0 },
        contentDescription: settingsOpen ? "关闭 DeepSeek Harness 设置" : "打开 DeepSeek Harness 设置",
        onClick: onSettings,
    }, UI.Icon({
        name: settingsOpen ? "close" : "settings",
        size: 17,
        tint: contentColor,
    }));
}

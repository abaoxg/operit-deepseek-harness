"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDshSubagentPanel = createDshSubagentPanel;

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function formatAge(value) {
    const seconds = Math.max(0, Math.round(finiteNumber(value)));
    if (seconds < 60)
        return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes < 60)
        return `${minutes}m ${rest}s ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ago`;
}

function formatGeneratedAt(value) {
    if (typeof value !== "string" || !value)
        return "尚未刷新";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "更新时间未知";
    return `更新于 ${date.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    })}`;
}

function tokenTotal(value) {
    if (!isRecord(value))
        return 0;
    const input = finiteNumber(value.input ?? value.inputTokens ?? value.prompt ?? value.promptTokens);
    const output = finiteNumber(value.output ?? value.outputTokens ?? value.completion ?? value.completionTokens);
    return Math.round(input + output);
}

function toolCallTotal(value) {
    if (!isRecord(value))
        return 0;
    return Math.max(0, Math.round(finiteNumber(value.total)));
}

function statusPresentation(status, colors) {
    switch (status) {
        case "running":
            return {
                label: "运行中",
                icon: "sync",
                container: colors.secondaryContainer,
                content: colors.onSecondaryContainer,
            };
        case "done":
            return {
                label: "已完成",
                icon: "check_circle",
                container: colors.primaryContainer,
                content: colors.onPrimaryContainer,
            };
        case "failed":
            return {
                label: "失败",
                icon: "error",
                container: colors.errorContainer,
                content: colors.onErrorContainer,
            };
        case "cancelled":
            return {
                label: "已取消",
                icon: "block",
                container: colors.surfaceVariant,
                content: colors.onSurfaceVariant,
            };
        case "timeout":
            return {
                label: "超时",
                icon: "schedule",
                container: colors.tertiaryContainer,
                content: colors.onTertiaryContainer,
            };
        default:
            return {
                label: "未知",
                icon: "help",
                container: colors.surfaceVariant,
                content: colors.onSurfaceVariant,
            };
    }
}

function metric(UI, colors, value, label) {
    return UI.Column({
        weight: 1,
        horizontalAlignment: "center",
        spacing: 2,
    }, [
        UI.Text({
            text: String(value),
            style: "titleMedium",
            fontWeight: "semiBold",
            color: colors.onSurface,
            maxLines: 1,
        }),
        UI.Text({
            text: label,
            style: "labelSmall",
            color: colors.onSurfaceVariant,
            maxLines: 1,
        }),
    ]);
}

function firstErrorText(errors) {
    if (!Array.isArray(errors) || errors.length === 0)
        return "";
    const error = errors[errors.length - 1];
    if (typeof error === "string")
        return error;
    if (!isRecord(error))
        return String(error);
    return String(error.snippet ?? error.message ?? error.error ?? "任务记录了工具错误");
}

function agentCard(UI, colors, agent) {
    const status = typeof agent.status === "string" ? agent.status : "unknown";
    const presentation = statusPresentation(status, colors);
    const taskId = typeof agent.taskId === "string" && agent.taskId ? agent.taskId : "unknown-task";
    const activity = typeof agent.currentActivity === "string" ? agent.currentActivity.trim() : "";
    const answer = typeof agent.answer === "string" ? agent.answer.trim() : "";
    const error = firstErrorText(agent.errors);
    const statisticsMatched = agent.matched === true;
    const metrics = statisticsMatched
        ? `步骤 ${Math.max(0, Math.round(finiteNumber(agent.steps)))} · 回合 ${Math.max(0, Math.round(finiteNumber(agent.turns)))} · 工具 ${toolCallTotal(agent.toolCalls)} · Tokens ${tokenTotal(agent.tokens)}`
        : "统计未解析 · 步骤 -- · 回合 -- · 工具 -- · Tokens --";
    return UI.Surface({
        fillMaxWidth: true,
        shape: { cornerRadius: 8 },
        containerColor: colors.surfaceVariant,
        contentColor: colors.onSurfaceVariant,
    }, UI.Column({
        fillMaxWidth: true,
        padding: 14,
        spacing: 10,
    }, [
        UI.Row({
            fillMaxWidth: true,
            verticalAlignment: "center",
            spacing: 8,
        }, [
            UI.Surface({
                shape: { cornerRadius: 8 },
                containerColor: presentation.container,
                contentColor: presentation.content,
            }, UI.Row({
                padding: { horizontal: 8, vertical: 4 },
                verticalAlignment: "center",
                spacing: 4,
            }, [
                UI.Icon({
                    name: presentation.icon,
                    size: 14,
                    tint: presentation.content,
                    spin: status === "running",
                    spinDurationMs: 900,
                }),
                UI.Text({
                    text: presentation.label,
                    style: "labelSmall",
                    color: presentation.content,
                    maxLines: 1,
                }),
            ])),
            UI.Text({
                text: taskId,
                weight: 1,
                style: "labelMedium",
                fontFamily: "monospace",
                color: colors.onSurface,
                maxLines: 1,
                overflow: "ellipsis",
            }),
            UI.Text({
                text: formatAge(agent.elapsedSec),
                style: "labelSmall",
                color: colors.onSurfaceVariant,
                maxLines: 1,
            }),
        ]),
        UI.Text({
            text: metrics,
            style: "bodySmall",
            color: colors.onSurfaceVariant,
            maxLines: 2,
        }),
        ...(activity ? [
            UI.Column({ spacing: 2 }, [
                UI.Text({
                    text: status === "running" ? "当前活动" : "最后活动",
                    style: "labelSmall",
                    color: colors.onSurfaceVariant,
                }),
                UI.Text({
                    text: activity,
                    style: "bodyMedium",
                    color: colors.onSurface,
                    maxLines: 3,
                    overflow: "ellipsis",
                }),
            ]),
        ] : []),
        ...(error ? [
            UI.Text({
                text: error,
                style: "bodySmall",
                color: colors.error,
                maxLines: 3,
                overflow: "ellipsis",
            }),
        ] : []),
        ...(answer ? [
            UI.HorizontalDivider({
                color: colors.outlineVariant,
                thickness: 1,
            }),
            UI.Text({
                text: "最终答案",
                style: "labelSmall",
                fontWeight: "semiBold",
                color: colors.onSurfaceVariant,
            }),
            UI.SelectionContainer({}, UI.Text({
                text: answer,
                style: "bodySmall",
                color: colors.onSurface,
                maxLines: 8,
                overflow: "ellipsis",
            })),
        ] : []),
    ]));
}

function createDshSubagentPanel(params) {
    const {
        UI,
        colors,
        panelState,
        panelLoading,
        panelCleaning,
        cleanupNotice,
        panelError,
        onRefresh,
        onClear,
    } = params;
    const state = isRecord(panelState) ? panelState : null;
    const agents = state && Array.isArray(state.agents) ? state.agents.filter(isRecord) : [];
    const total = state ? Math.max(0, Math.round(finiteNumber(state.count ?? agents.length))) : 0;
    const running = state ? Math.max(0, Math.round(finiteNumber(state.running))) : 0;
    const done = agents.filter((agent) => agent.status === "done").length;
    const failed = agents.filter((agent) => agent.status === "failed").length;
    const clearable = agents.filter((agent) => ["done", "failed", "cancelled", "timeout"].includes(agent.status)).length;
    const content = [
        UI.Row({
            fillMaxWidth: true,
            verticalAlignment: "center",
        }, [
            UI.Column({
                weight: 1,
                spacing: 2,
            }, [
                UI.Text({
                    text: "Sub-Agent 监控面板",
                    style: "titleMedium",
                    fontWeight: "semiBold",
                    color: colors.onSurface,
                }),
                UI.Text({
                    text: formatGeneratedAt(state?.generatedAt),
                    style: "labelSmall",
                    color: colors.onSurfaceVariant,
                }),
            ]),
            UI.OutlinedButton({
                enabled: clearable > 0 && !panelLoading && !panelCleaning,
                width: 44,
                height: 40,
                shape: { cornerRadius: 8 },
                contentPadding: { horizontal: 0, vertical: 0 },
                contentDescription: "清理已结束任务",
                onClick: onClear,
            }, UI.Icon({
                name: panelCleaning ? "sync" : "delete",
                size: 18,
                tint: panelCleaning
                    ? colors.onSurfaceVariant
                    : clearable > 0 ? colors.error : colors.onSurfaceVariant.copy({ alpha: 0.45 }),
                spin: panelCleaning,
                spinDurationMs: 850,
            })),
            UI.Spacer({ width: 8 }),
            UI.OutlinedButton({
                enabled: !panelLoading && !panelCleaning,
                width: 44,
                height: 40,
                shape: { cornerRadius: 8 },
                contentPadding: { horizontal: 0, vertical: 0 },
                contentDescription: "刷新 Sub-Agent 状态",
                onClick: onRefresh,
            }, UI.Icon({
                name: panelLoading ? "sync" : "refresh",
                size: 18,
                tint: panelLoading ? colors.onSurfaceVariant : colors.primary,
                spin: panelLoading,
                spinDurationMs: 850,
            })),
        ]),
    ];
    if (state) {
        content.push(UI.Row({
            fillMaxWidth: true,
            padding: { vertical: 4 },
        }, [
            metric(UI, colors, total, "任务"),
            metric(UI, colors, running, "运行中"),
            metric(UI, colors, done, "已完成"),
            metric(UI, colors, failed, "失败"),
        ]));
    }
    content.push(UI.HorizontalDivider({
        color: colors.outlineVariant,
        thickness: 1,
    }));
    if (cleanupNotice) {
        content.push(UI.Text({
            text: cleanupNotice,
            style: "bodySmall",
            color: colors.primary,
            maxLines: 2,
            overflow: "ellipsis",
        }));
    }
    if (panelError) {
        content.push(UI.Surface({
            fillMaxWidth: true,
            shape: { cornerRadius: 8 },
            containerColor: colors.errorContainer,
            contentColor: colors.onErrorContainer,
        }, UI.Row({
            fillMaxWidth: true,
            padding: 12,
            verticalAlignment: "center",
            spacing: 8,
        }, [
            UI.Icon({
                name: "error",
                size: 18,
                tint: colors.onErrorContainer,
            }),
            UI.Text({
                text: panelError,
                weight: 1,
                style: "bodySmall",
                color: colors.onErrorContainer,
                maxLines: 4,
                overflow: "ellipsis",
            }),
        ])));
    }
    if (!state && panelLoading) {
        content.push(UI.Column({
            fillMaxWidth: true,
            padding: { vertical: 48 },
            horizontalAlignment: "center",
            spacing: 12,
        }, [
            UI.CircularProgressIndicator({
                size: 30,
                color: colors.primary,
                strokeWidth: 3,
            }),
            UI.Text({
                text: "正在读取 Sub-Agent 状态",
                style: "bodyMedium",
                color: colors.onSurfaceVariant,
            }),
        ]));
    } else if (!state && panelError) {
        content.push(UI.OutlinedButton({
            fillMaxWidth: true,
            height: 44,
            shape: { cornerRadius: 8 },
            onClick: onRefresh,
        }, UI.Text({
            text: "重试",
            style: "labelMedium",
            color: colors.primary,
        })));
    } else if (state && agents.length === 0) {
        content.push(UI.Column({
            fillMaxWidth: true,
            padding: { vertical: 48 },
            horizontalAlignment: "center",
            spacing: 8,
        }, [
            UI.Icon({
                name: "inbox",
                size: 30,
                tint: colors.onSurfaceVariant,
            }),
            UI.Text({
                text: "暂无 Sub-Agent 任务",
                style: "bodyMedium",
                color: colors.onSurfaceVariant,
            }),
        ]));
    } else {
        for (const agent of agents)
            content.push(agentCard(UI, colors, agent));
    }
    return UI.LazyColumn({
        fillMaxSize: true,
        background: colors.surface,
        padding: { horizontal: 14, vertical: 12 },
        spacing: 12,
    }, content);
}

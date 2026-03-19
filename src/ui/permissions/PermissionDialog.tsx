// ── 权限对话框 ───────────────────────────────────────────────────
// 复刻 Claude Code 的权限审批框：圆角边框 + 工具信息 + 选项。
// 支持 PermissionRenderer 插槽自定义。

import React, { useState } from "react";
import { Text, Box, useInput } from "ink";
import { useTheme, useRegistry } from "../hooks/use-registry.js";
import { FallbackPermission } from "./FallbackPermission.js";

export interface PermissionRequest {
    id: string;
    toolName: string;
    args: Record<string, unknown>;
}

interface PermissionDialogProps {
    request: PermissionRequest;
    onResolve: (approved: boolean, value?: string) => void;
}

const DEFAULT_OPTIONS = [
    { label: "Yes, allow this", value: "allow" },
    { label: "Yes, always allow this tool", value: "always" },
    { label: "No, deny", value: "deny" },
];

export function PermissionDialog({ request, onResolve }: PermissionDialogProps) {
    const theme = useTheme();
    const registry = useRegistry();
    const renderer = registry.getPermissionRenderer(request.toolName);

    const risk = renderer?.assessRisk?.(request.args) ?? "moderate";
    const options = renderer?.getApprovalOptions?.(request.args) ?? DEFAULT_OPTIONS;
    const [selectedIdx, setSelectedIdx] = useState(0);

    const borderColor = risk === "high" ? theme.error
        : risk === "moderate" ? theme.warning
        : theme.permissionBorder;

    useInput((_input, key) => {
        if (key.upArrow) setSelectedIdx(i => Math.max(0, i - 1));
        else if (key.downArrow) setSelectedIdx(i => Math.min(options.length - 1, i + 1));
        else if (key.return) {
            const value = options[selectedIdx].value;
            onResolve(value !== "deny", value);
        }
    });

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={borderColor}
            paddingX={1}
            paddingY={0}
            marginY={1}
        >
            <Text bold color={borderColor}>
                Permission required
                {risk === "high" && " ⚠ HIGH RISK"}
            </Text>
            <Text> </Text>

            {renderer?.renderPermissionBody
                ? renderer.renderPermissionBody(request.args, theme)
                : <FallbackPermission toolName={request.toolName} args={request.args} theme={theme} />
            }

            <Text> </Text>
            {options.map((opt, i) => (
                <Text key={opt.value}>
                    <Text color={i === selectedIdx ? theme.brand : theme.secondaryText}>
                        {i === selectedIdx ? "❯ " : "  "}
                    </Text>
                    <Text color={i === selectedIdx ? theme.text : theme.secondaryText}>
                        {opt.label}
                    </Text>
                </Text>
            ))}
        </Box>
    );
}

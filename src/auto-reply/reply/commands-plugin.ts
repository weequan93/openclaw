/**
 * Plugin Command Handler
 *
 * Handles commands registered by plugins, bypassing the LLM agent.
 * This handler is called before built-in command handlers.
 */

import type { CommandHandler, CommandHandlerResult } from "./commands-types.js";
import { logVerbose } from "../../globals.js";
import { matchPluginCommand, executePluginCommand } from "../../plugins/commands.js";
import { recordCommandAuthzDeny } from "./command-authz-audit.js";

/**
 * Handle plugin-registered commands.
 * Returns a result if a plugin command was matched and executed,
 * or null to continue to the next handler.
 */
export const handlePluginCommand: CommandHandler = async (
  params,
  allowTextCommands,
): Promise<CommandHandlerResult | null> => {
  const { command, cfg } = params;

  if (!allowTextCommands) {
    return null;
  }

  // Try to match a plugin command
  const match = matchPluginCommand(command.commandBodyNormalized);
  if (!match) {
    return null;
  }

  const requireAuth = match.command.requireAuth !== false;
  if (requireAuth && !command.isAuthorizedSender) {
    logVerbose(
      `Ignoring plugin command /${match.command.name} from unauthorized sender: ${command.senderId || "<unknown>"}`,
    );
    recordCommandAuthzDeny({
      ctx: params.ctx,
      command,
      method: "command.plugin",
      reasonCode: "UNKNOWN_SENDER",
      message: `/${match.command.name} denied for unauthorized sender`,
    });
    return {
      shouldContinue: false,
      reply: { text: "⚠️ This command requires authorization." },
    };
  }

  // Execute the plugin command (always returns a result)
  const result = await executePluginCommand({
    command: match.command,
    args: match.args,
    senderId: command.senderId,
    channel: command.channel,
    channelId: command.channelId,
    isAuthorizedSender: command.isAuthorizedSender,
    commandBody: command.commandBodyNormalized,
    config: cfg,
    from: command.from,
    to: command.to,
    accountId: params.ctx.AccountId ?? undefined,
    messageThreadId:
      typeof params.ctx.MessageThreadId === "number" ? params.ctx.MessageThreadId : undefined,
  });

  return {
    shouldContinue: false,
    reply: result,
  };
};

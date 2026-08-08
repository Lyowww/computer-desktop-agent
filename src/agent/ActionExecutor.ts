import {
  ExecuteActionPayload,
  ExecuteActionPayloadSchema,
  ServerMessageSchema,
  normalizeActionType,
  TypeTextParamsSchema,
  KeyPressParamsSchema,
  HotkeyParamsSchema,
  OpenAppParamsSchema,
  WaitParamsSchema,
  AskUserParamsSchema,
  WAIT_MS_MIN,
  ClickParamsSchema,
  DoubleClickParamsSchema,
  MoveMouseParamsSchema,
  ScrollParamsSchema,
  DragParamsSchema,
} from "../utils/validation";
import { MouseService } from "../automation/mouse/MouseService";
import { KeyboardService } from "../automation/keyboard/KeyboardService";
import { ApplicationService } from "../automation/applications/ApplicationService";
import { ScreenshotService } from "../screenshot/ScreenshotService";
import { CameraService } from "../screenshot/CameraService";
import { PermissionManager } from "../permissions/PermissionManager";
import { LockScreenDetector } from "../security/LockScreenDetector";
import { UnlockService } from "../security/UnlockService";
import { rootLogger } from "../utils/logger";
import type { ActionResultPayload, ScreenResultPayload } from "../websocket/protocol";
import { mouse, Button } from "@nut-tree-fork/nut-js";

const log = rootLogger.child("executor");

function redactTextPreview(text: string): string {
  if (text.length <= 8) return `[len=${text.length}]`;
  return `[len=${text.length} prefix=${JSON.stringify(text.slice(0, 4))}…]`;
}

export class ActionExecutor {
  constructor(
    private readonly mouseSvc = new MouseService(),
    private readonly keyboard = new KeyboardService(),
    private readonly apps = new ApplicationService(),
    private readonly screenshots = new ScreenshotService(),
    private readonly camera = new CameraService(),
    private readonly permissions = new PermissionManager(),
    private readonly lockScreen = new LockScreenDetector(),
    private readonly unlock = new UnlockService()
  ) {}

  validateAction(raw: unknown): ExecuteActionPayload {
    return ExecuteActionPayloadSchema.parse(raw);
  }

  validateServerMessage(raw: unknown) {
    return ServerMessageSchema.parse(raw);
  }

  private lockedFailure(
    actionId: string,
    taskId: string,
    detail?: string
  ): ActionResultPayload {
    return {
      actionId,
      taskId,
      success: false,
      status: "LOCKED",
      error: detail ?? "Computer is locked; refusing input and capture",
    };
  }

  /** Wake lock UI and type stored password when locked; otherwise no-op. */
  private async ensureDesktopReady(
    actionId: string,
    taskId: string
  ): Promise<ActionResultPayload | null> {
    if (!(await this.lockScreen.isLocked())) {
      return null;
    }

    const attempt = await this.unlock.ensureUnlocked();
    if (attempt.ok) {
      return null;
    }

    if (attempt.reason === "NO_PASSWORD") {
      return this.lockedFailure(
        actionId,
        taskId,
        "Computer is locked; set an unlock password in Settings to allow remote unlock"
      );
    }

    return this.lockedFailure(
      actionId,
      taskId,
      attempt.error ??
        `Computer is locked; unlock failed (${attempt.reason.toLowerCase()})`
    );
  }

  async execute(
    action: ExecuteActionPayload,
    options: { paused: boolean }
  ): Promise<ActionResultPayload> {
    if (options.paused) {
      return {
        actionId: action.actionId,
        taskId: action.taskId,
        success: false,
        status: "PAUSED",
        error: "Agent is paused",
      };
    }

    const type = normalizeActionType(action.type);
    log.info(`Received action: ${type}`, {
      actionId: action.actionId,
      taskId: action.taskId,
      type,
    });

    try {
      if (type === "ASK_USER") {
        const params = AskUserParamsSchema.parse(action.params);
        // Desktop never prompts UI itself — acknowledge so backend/web can ask the user.
        log.info("ASK_USER acknowledged (no OS execution)", {
          questionLength: params.question.length,
        });
        return {
          actionId: action.actionId,
          taskId: action.taskId,
          success: true,
          status: "OK",
          result: {
            askUser: true,
            question: params.question,
            reason: params.reason,
            executedAt: new Date().toISOString(),
          },
        };
      }

      if (type === "LOCK_SCREEN") {
        await this.unlock.openLockScreen();
        return {
          actionId: action.actionId,
          taskId: action.taskId,
          success: true,
          status: "OK",
          result: { locked: true },
        };
      }

      if (type === "UNLOCK_SCREEN") {
        const attempt = await this.unlock.ensureUnlocked();
        if (!attempt.ok) {
          return this.lockedFailure(
            action.actionId,
            action.taskId,
            attempt.reason === "NO_PASSWORD"
              ? "No unlock password configured in Settings"
              : attempt.error ?? `Unlock failed (${attempt.reason.toLowerCase()})`
          );
        }
        return {
          actionId: action.actionId,
          taskId: action.taskId,
          success: true,
          status: "OK",
          result: { unlocked: true, alreadyUnlocked: Boolean(attempt.alreadyUnlocked) },
        };
      }

      const lockBlock = await this.ensureDesktopReady(action.actionId, action.taskId);
      if (lockBlock) return lockBlock;

      switch (type) {
        case "SCREENSHOT": {
          await this.permissions.assertReadyForScreenshot();
          // Do not rebind coordinate space to a different maxWidth — planning uses 1280 captures.
          const shot = await this.screenshots.capture({
            maxWidth: 1280,
            bindCoordinateSpace: false,
            taskId: action.taskId,
          });
          return {
            actionId: action.actionId,
            taskId: action.taskId,
            success: true,
            status: "OK",
            result: {
              width: shot.width,
              height: shot.height,
              image: shot.imageBase64,
              mimeType: "image/png",
            },
          };
        }
        case "CLICK": {
          const params = ClickParamsSchema.parse(action.params);
          await this.permissions.assertReadyForInput();
          log.info(`Executing CLICK at ${params.x},${params.y}`, {
            taskId: action.taskId,
            targetLabel:
              typeof (params as { targetLabel?: string }).targetLabel === "string"
                ? (params as { targetLabel?: string }).targetLabel
                : undefined,
          });
          await this.mouseSvc.click(
            params.x,
            params.y,
            params.button as "LEFT" | "RIGHT" | "MIDDLE",
            action.taskId
          );
          break;
        }
        case "RIGHT_CLICK": {
          const params = MoveMouseParamsSchema.parse(action.params);
          await this.permissions.assertReadyForInput();
          log.info(`Executing RIGHT_CLICK at ${params.x},${params.y}`, {
            taskId: action.taskId,
          });
          await this.mouseSvc.click(params.x, params.y, "RIGHT", action.taskId);
          break;
        }
        case "DOUBLE_CLICK": {
          const params = DoubleClickParamsSchema.parse(action.params);
          await this.permissions.assertReadyForInput();
          log.info(`Executing DOUBLE_CLICK at ${params.x},${params.y}`, {
            taskId: action.taskId,
          });
          await this.mouseSvc.doubleClick(
            params.x,
            params.y,
            params.button as "LEFT" | "RIGHT" | "MIDDLE",
            action.taskId
          );
          break;
        }
        case "MOVE_MOUSE": {
          const params = MoveMouseParamsSchema.parse(action.params);
          await this.permissions.assertReadyForInput();
          log.info(`Executing MOVE_MOUSE at ${params.x},${params.y}`, {
            taskId: action.taskId,
          });
          await this.mouseSvc.move(params.x, params.y, action.taskId);
          break;
        }
        case "TYPE_TEXT": {
          const params = TypeTextParamsSchema.parse(action.params);
          await this.permissions.assertReadyForInput();
          log.info("Executing TYPE_TEXT", { text: redactTextPreview(params.text) });
          await this.keyboard.typeText(params.text);
          break;
        }
        case "KEY_PRESS": {
          const params = KeyPressParamsSchema.parse(action.params);
          await this.permissions.assertReadyForInput();
          log.info("Executing KEY_PRESS", { key: params.key });
          await this.keyboard.keyPress(params.key);
          break;
        }
        case "HOTKEY": {
          const params = HotkeyParamsSchema.parse(action.params);
          await this.permissions.assertReadyForInput();
          log.info("Executing HOTKEY", { keys: params.keys });
          await this.keyboard.hotkey(params.keys);
          break;
        }
        case "OPEN_APP": {
          const params = OpenAppParamsSchema.parse(action.params);
          log.info("Executing OPEN_APP", { app: params.app });
          const result = await this.apps.openApp(params.app);
          log.info("Action succeeded", { type, app: result.app });
          return {
            actionId: action.actionId,
            taskId: action.taskId,
            success: true,
            status: "OK",
            result: { app: result.app, executedAt: new Date().toISOString() },
          };
        }
        case "WAIT": {
          const params = WaitParamsSchema.parse(action.params);
          const ms = params.ms ?? params.durationMs ?? WAIT_MS_MIN;
          log.info("Executing WAIT", { ms });
          await new Promise((resolve) => setTimeout(resolve, ms));
          break;
        }
        case "SCROLL": {
          const params = ScrollParamsSchema.parse(action.params);
          await this.permissions.assertReadyForInput();
          if (params.x !== undefined && params.y !== undefined) {
            await this.mouseSvc.move(params.x, params.y);
          }
          const amount = Math.abs(params.amount ?? params.deltaY ?? 3);
          const direction =
            params.direction ?? (params.deltaY !== undefined && params.deltaY < 0 ? "up" : "down");
          if (direction === "up" || (params.deltaY !== undefined && params.deltaY < 0)) {
            await mouse.scrollUp(amount);
          } else if (direction === "left" || (params.deltaX !== undefined && params.deltaX < 0)) {
            await mouse.scrollLeft(amount);
          } else if (direction === "right" || (params.deltaX !== undefined && params.deltaX > 0)) {
            await mouse.scrollRight(amount);
          } else {
            await mouse.scrollDown(amount);
          }
          break;
        }
        case "DRAG": {
          const params = DragParamsSchema.parse(action.params);
          await this.permissions.assertReadyForInput();
          const from = await this.mouseSvc.resolvePoint(params.fromX, params.fromY);
          const to = await this.mouseSvc.resolvePoint(params.toX, params.toY);
          await this.mouseSvc.move(params.fromX, params.fromY);
          await mouse.pressButton(Button.LEFT);
          await this.mouseSvc.move(params.toX, params.toY);
          await mouse.releaseButton(Button.LEFT);
          log.info("Executing DRAG", {
            from: { x: from.x, y: from.y },
            to: { x: to.x, y: to.y },
          });
          break;
        }
        case "DONE":
        case "FAIL":
          return {
            actionId: action.actionId,
            taskId: action.taskId,
            success: type === "DONE",
            status: "OK",
            result: { terminal: type, executedAt: new Date().toISOString() },
          };
        default: {
          const _exhaustive: never = type;
          return _exhaustive;
        }
      }

      log.info("Action succeeded", { type, actionId: action.actionId });
      return {
        actionId: action.actionId,
        taskId: action.taskId,
        success: true,
        status: "OK",
        result: { executedAt: new Date().toISOString() },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("Action execution failed", { actionId: action.actionId, type: action.type, message });
      return {
        actionId: action.actionId,
        taskId: action.taskId,
        success: false,
        status: "ERROR",
        error: message,
      };
    }
  }

  async captureScreen(
    requestId: string,
    options: { maxWidth?: number; quality?: number; taskId?: string } = {}
  ): Promise<ScreenResultPayload | ActionResultPayload> {
    const lockBlock = await this.ensureDesktopReady(requestId, options.taskId ?? requestId);
    if (lockBlock) return lockBlock;

    await this.permissions.assertReadyForScreenshot();
    const shot = await this.screenshots.capture({
      maxWidth: options.maxWidth,
      quality: options.quality,
      taskId: options.taskId,
      // Preview-only captures (no task) must not overwrite task click mapping.
      bindCoordinateSpace: Boolean(options.taskId),
    });
    return {
      requestId,
      taskId: options.taskId,
      width: shot.width,
      height: shot.height,
      image: shot.imageBase64,
      mimeType: "image/png",
    };
  }

  async captureCamera(
    requestId: string,
    options: { maxWidth?: number; quality?: number; taskId?: string } = {}
  ): Promise<ScreenResultPayload | ActionResultPayload> {
    const lockBlock = await this.ensureDesktopReady(requestId, options.taskId ?? requestId);
    if (lockBlock) return lockBlock;

    await this.permissions.assertReadyForCamera();
    const shot = await this.camera.capture({
      maxWidth: options.maxWidth,
      quality: options.quality,
    });
    return {
      requestId,
      taskId: options.taskId,
      width: shot.width,
      height: shot.height,
      image: shot.imageBase64,
      mimeType: shot.mimeType,
    };
  }
}

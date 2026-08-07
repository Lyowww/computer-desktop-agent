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
import { PermissionManager } from "../permissions/PermissionManager";
import { LockScreenDetector } from "../security/LockScreenDetector";
import { rootLogger } from "../utils/logger";
import type { ActionResultPayload, ScreenResultPayload } from "../websocket/protocol";
import { mouse, Button } from "@nut-tree-fork/nut-js";

const log = rootLogger.child("executor");

export class ActionExecutor {
  constructor(
    private readonly mouseSvc = new MouseService(),
    private readonly keyboard = new KeyboardService(),
    private readonly apps = new ApplicationService(),
    private readonly screenshots = new ScreenshotService(),
    private readonly permissions = new PermissionManager(),
    private readonly lockScreen = new LockScreenDetector()
  ) {}

  validateAction(raw: unknown): ExecuteActionPayload {
    return ExecuteActionPayloadSchema.parse(raw);
  }

  validateServerMessage(raw: unknown) {
    return ServerMessageSchema.parse(raw);
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

    const locked = await this.lockScreen.isLocked();
    if (locked) {
      return {
        actionId: action.actionId,
        taskId: action.taskId,
        success: false,
        status: "LOCKED",
        error: "Computer is locked; refusing input and capture",
      };
    }

    const type = normalizeActionType(action.type);

    try {
      switch (type) {
        case "SCREENSHOT": {
          await this.permissions.assertReadyForScreenshot();
          const shot = await this.screenshots.capture({ maxWidth: 1920 });
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
          await this.mouseSvc.click(params.x, params.y, params.button);
          break;
        }
        case "RIGHT_CLICK": {
          const params = MoveMouseParamsSchema.parse(action.params);
          await this.permissions.assertReadyForInput();
          await this.mouseSvc.click(params.x, params.y, "RIGHT");
          break;
        }
        case "DOUBLE_CLICK": {
          const params = DoubleClickParamsSchema.parse(action.params);
          await this.permissions.assertReadyForInput();
          await this.mouseSvc.doubleClick(params.x, params.y, params.button);
          break;
        }
        case "MOVE_MOUSE": {
          const params = MoveMouseParamsSchema.parse(action.params);
          await this.permissions.assertReadyForInput();
          await this.mouseSvc.move(params.x, params.y);
          break;
        }
        case "TYPE_TEXT": {
          const params = TypeTextParamsSchema.parse(action.params);
          await this.permissions.assertReadyForInput();
          await this.keyboard.typeText(params.text);
          break;
        }
        case "KEY_PRESS": {
          const params = KeyPressParamsSchema.parse(action.params);
          await this.permissions.assertReadyForInput();
          await this.keyboard.keyPress(params.key);
          break;
        }
        case "HOTKEY": {
          const params = HotkeyParamsSchema.parse(action.params);
          await this.permissions.assertReadyForInput();
          await this.keyboard.hotkey(params.keys);
          break;
        }
        case "OPEN_APP": {
          const params = OpenAppParamsSchema.parse(action.params);
          const result = await this.apps.openApp(params.app);
          return {
            actionId: action.actionId,
            taskId: action.taskId,
            success: true,
            status: "OK",
            result: { app: result.app },
          };
        }
        case "WAIT": {
          const params = WaitParamsSchema.parse(action.params);
          const ms = params.ms ?? params.durationMs ?? 0;
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
          const direction = params.direction ?? (params.deltaY !== undefined && params.deltaY < 0 ? "up" : "down");
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
          await this.mouseSvc.move(params.fromX, params.fromY);
          await mouse.pressButton(Button.LEFT);
          await this.mouseSvc.move(params.toX, params.toY);
          await mouse.releaseButton(Button.LEFT);
          break;
        }
        case "DONE":
        case "FAIL":
          return {
            actionId: action.actionId,
            taskId: action.taskId,
            success: type === "DONE",
            status: "OK",
            result: { terminal: type },
          };
        default: {
          const _exhaustive: never = type;
          return _exhaustive;
        }
      }

      return {
        actionId: action.actionId,
        taskId: action.taskId,
        success: true,
        status: "OK",
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
    const locked = await this.lockScreen.isLocked();
    if (locked) {
      return {
        actionId: requestId,
        taskId: options.taskId ?? requestId,
        success: false,
        status: "LOCKED",
        error: "Computer is locked; refusing screenshot",
      };
    }

    await this.permissions.assertReadyForScreenshot();
    const shot = await this.screenshots.capture({
      maxWidth: options.maxWidth,
      quality: options.quality,
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
}

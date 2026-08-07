import {
  ExecuteActionPayload,
  ExecuteActionPayloadSchema,
  ServerMessageSchema,
} from "../utils/validation";
import { MouseService } from "../automation/mouse/MouseService";
import { KeyboardService } from "../automation/keyboard/KeyboardService";
import { ApplicationService } from "../automation/applications/ApplicationService";
import { ScreenshotService } from "../screenshot/ScreenshotService";
import { PermissionManager } from "../permissions/PermissionManager";
import { LockScreenDetector } from "../security/LockScreenDetector";
import { rootLogger } from "../utils/logger";
import type { ActionResultPayload, ScreenResultPayload } from "../websocket/protocol";

const log = rootLogger.child("executor");

export class ActionExecutor {
  constructor(
    private readonly mouse = new MouseService(),
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
        success: false,
        status: "PAUSED",
        message: "Agent is paused",
      };
    }

    const locked = await this.lockScreen.isLocked();
    if (locked) {
      return {
        actionId: action.actionId,
        success: false,
        status: "LOCKED",
        message: "Computer is locked; refusing input and capture",
      };
    }

    try {
      switch (action.type) {
        case "SCREENSHOT": {
          await this.permissions.assertReadyForScreenshot();
          const shot = await this.screenshots.capture({ maxWidth: 1920 });
          return {
            actionId: action.actionId,
            success: true,
            status: "OK",
            data: {
              width: shot.width,
              height: shot.height,
              format: shot.format,
              imageBase64: shot.imageBase64,
              compressed: shot.compressed,
            },
          };
        }
        case "CLICK": {
          await this.permissions.assertReadyForInput();
          await this.mouse.click(action.params.x, action.params.y, action.params.button);
          break;
        }
        case "DOUBLE_CLICK": {
          await this.permissions.assertReadyForInput();
          await this.mouse.doubleClick(action.params.x, action.params.y, action.params.button);
          break;
        }
        case "MOVE_MOUSE": {
          await this.permissions.assertReadyForInput();
          await this.mouse.move(action.params.x, action.params.y);
          break;
        }
        case "TYPE_TEXT": {
          await this.permissions.assertReadyForInput();
          await this.keyboard.typeText(action.params.text);
          break;
        }
        case "KEY_PRESS": {
          await this.permissions.assertReadyForInput();
          await this.keyboard.keyPress(action.params.key);
          break;
        }
        case "HOTKEY": {
          await this.permissions.assertReadyForInput();
          await this.keyboard.hotkey(action.params.keys);
          break;
        }
        case "OPEN_APP": {
          const result = await this.apps.openApp(action.params.app);
          return {
            actionId: action.actionId,
            success: true,
            status: "OK",
            data: { app: result.app },
          };
        }
        case "WAIT": {
          await new Promise((resolve) => setTimeout(resolve, action.params.ms));
          break;
        }
        default: {
          const _exhaustive: never = action;
          return _exhaustive;
        }
      }

      return {
        actionId: action.actionId,
        success: true,
        status: "OK",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("Action execution failed", { actionId: action.actionId, type: action.type, message });
      return {
        actionId: action.actionId,
        success: false,
        status: "ERROR",
        message,
      };
    }
  }

  async captureScreen(requestId: string, maxWidth?: number, quality?: number): Promise<ScreenResultPayload | ActionResultPayload> {
    const locked = await this.lockScreen.isLocked();
    if (locked) {
      return {
        actionId: requestId,
        success: false,
        status: "LOCKED",
        message: "Computer is locked; refusing screenshot",
      };
    }

    await this.permissions.assertReadyForScreenshot();
    const shot = await this.screenshots.capture({ maxWidth, quality });
    return {
      requestId,
      width: shot.width,
      height: shot.height,
      format: "png",
      imageBase64: shot.imageBase64,
      compressed: shot.compressed,
    };
  }
}

// ============================================================
// Quit Barrier - 退出栅栏控制器
//
// 职责：
//   1) 把“应用退出前清理”封装为单次执行 Promise 栅栏
//   2) 对外提供 shouldAllowNativeQuit，避免重复拦截/重复清理
//   3) 在清理失败时进行统一兜底退出（hardExit）
//
// 设计目标：
//   - index.ts 只负责接线，不再持有退出状态机细节
//   - 退出路径可测试、可复用、可审计
// ============================================================

export interface QuitBarrierDeps {
  /** 设置“正在退出”状态，供主进程其他逻辑读取。 */
  setAppQuitting: (value: boolean) => void;
  /** 通知渲染进程展示“正在退出”提示。 */
  notifyRendererQuitting: () => void;
  /** 真正的清理执行函数（停止服务、释放资源等）。 */
  cleanupBeforeExit: () => Promise<void>;
  /** 软退出（正常流程，交由 Electron 自身退出）。 */
  quitApp: () => void;
  /** 硬退出（异常流程，直接退出进程）。 */
  hardExit: (code: number) => void;
  /** 统一错误上报。 */
  onError: (error: unknown) => void;
}

export interface QuitBarrierController {
  /** 触发退出栅栏：首次执行清理，后续复用同一 Promise。 */
  runQuitBarrier: () => Promise<void>;
  /** 是否允许原生 quit 直接放行（避免二次拦截）。 */
  shouldAllowNativeQuit: () => boolean;
}

/**
 * 创建退出栅栏控制器。
 *
 * 关键行为：
 * - 幂等：多次调用 runQuitBarrier 只触发一次清理
 * - 成功：cleanup 完成后放行 quit
 * - 失败：记录错误并 hardExit，避免僵死进程
 */
export function createQuitBarrierController(deps: QuitBarrierDeps): QuitBarrierController {
  let allowNativeQuit = false;
  let quitBarrierPromise: Promise<void> | null = null;

  async function runQuitBarrier(): Promise<void> {
    if (quitBarrierPromise) return quitBarrierPromise;
    deps.setAppQuitting(true);
    deps.notifyRendererQuitting();

    quitBarrierPromise = (async () => {
      await deps.cleanupBeforeExit();
      allowNativeQuit = true;
      deps.quitApp();
    })().catch((error) => {
      deps.onError(error);
      allowNativeQuit = true;
      deps.hardExit(1);
    });

    return quitBarrierPromise;
  }

  return {
    runQuitBarrier,
    shouldAllowNativeQuit: () => allowNativeQuit,
  };
}

import { MAX_CLOCK, MIN_CLOCK } from '../../lib';
import { usePlanner } from '../../store/plannerStore';

/** 选项 Tab：图表方向、信息详略、超频开关 + maxClock。 */
export default function OptionsTab() {
  const mode = usePlanner((s) => s.mode);
  const direction = usePlanner((s) => s.direction);
  const setDirection = usePlanner((s) => s.setDirection);
  const detail = usePlanner((s) => s.detail);
  const setDetail = usePlanner((s) => s.setDetail);
  const overclockEnabled = usePlanner((s) => s.overclockEnabled);
  const setOverclockEnabled = usePlanner((s) => s.setOverclockEnabled);
  const maxClock = usePlanner((s) => s.maxClock);
  const setMaxClock = usePlanner((s) => s.setMaxClock);

  return (
    <div className="panel__tab">
      <section className="panel__section">
        <h3 className="panel__section-title">图表方向</h3>
        <div className="seg">
          <button
            className={`seg__btn ${direction === 'LR' ? 'seg__btn--active' : ''}`}
            onClick={() => setDirection('LR')}
          >
            左右 LR
          </button>
          <button
            className={`seg__btn ${direction === 'TB' ? 'seg__btn--active' : ''}`}
            onClick={() => setDirection('TB')}
          >
            上下 TB
          </button>
        </div>
      </section>

      <section className="panel__section">
        <h3 className="panel__section-title">信息详略</h3>
        <div className="seg">
          <button
            className={`seg__btn ${detail === 'simple' ? 'seg__btn--active' : ''}`}
            onClick={() => setDetail('simple')}
          >
            简单
          </button>
          <button
            className={`seg__btn ${detail === 'detailed' ? 'seg__btn--active' : ''}`}
            onClick={() => setDetail('detailed')}
          >
            详细
          </button>
        </div>
        <p className="panel__hint">
          简单模式隐藏建筑名与利用率 / 功耗小字；详细模式全显。
        </p>
      </section>

      <section className="panel__section">
        <h3 className="panel__section-title">超频</h3>
        <label className="switch">
          <input
            type="checkbox"
            checked={overclockEnabled}
            onChange={(e) => setOverclockEnabled(e.target.checked)}
          />
          启用超频凑整
        </label>
        {overclockEnabled ? (
          <label className="panel__field panel__field--col">
            <span className="panel__unit">
              最大超频倍率 {maxClock.toFixed(1)}x
            </span>
            <input
              type="range"
              min={MIN_CLOCK}
              max={MAX_CLOCK}
              step={0.1}
              value={maxClock}
              disabled={mode !== 'forward'}
              onChange={(e) => setMaxClock(Number(e.target.value))}
            />
          </label>
        ) : null}
        <p className="panel__hint">
          {overclockEnabled
            ? mode === 'forward'
              ? '产线取向：用更少机器超频凑整（maxClock 上限可调），机器数 = ⌈需求 ÷ (单机产能 × maxClock)⌉。'
              : '成品取向恒用小数机器数对标计算器；超频上限仅影响产线取向。'
            : '整数模式：每级机器向上取整 + 显示利用率（产线取向）。'}
        </p>
      </section>
    </div>
  );
}

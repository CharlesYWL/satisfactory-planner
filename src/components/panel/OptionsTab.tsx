import { useTranslation } from 'react-i18next';
import { MAX_CLOCK, MIN_CLOCK } from '../../lib';
import { setLang, useLang } from '../../i18n';
import { usePlanner } from '../../store/plannerStore';

/** 选项 Tab：语言、图表方向、信息详略、超频开关 + maxClock。 */
export default function OptionsTab() {
  const { t } = useTranslation();
  const lang = useLang();
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
        <h3 className="panel__section-title">{t('options.languageTitle')}</h3>
        <div className="seg">
          <button
            className={`seg__btn ${lang === 'zh' ? 'seg__btn--active' : ''}`}
            onClick={() => setLang('zh')}
          >
            {t('options.languageZh')}
          </button>
          <button
            className={`seg__btn ${lang === 'en' ? 'seg__btn--active' : ''}`}
            onClick={() => setLang('en')}
          >
            {t('options.languageEn')}
          </button>
        </div>
      </section>

      <section className="panel__section">
        <h3 className="panel__section-title">{t('options.directionTitle')}</h3>
        <div className="seg">
          <button
            className={`seg__btn ${direction === 'LR' ? 'seg__btn--active' : ''}`}
            onClick={() => setDirection('LR')}
          >
            {t('options.directionLR')}
          </button>
          <button
            className={`seg__btn ${direction === 'TB' ? 'seg__btn--active' : ''}`}
            onClick={() => setDirection('TB')}
          >
            {t('options.directionTB')}
          </button>
        </div>
      </section>

      <section className="panel__section">
        <h3 className="panel__section-title">{t('options.detailTitle')}</h3>
        <div className="seg">
          <button
            className={`seg__btn ${detail === 'simple' ? 'seg__btn--active' : ''}`}
            onClick={() => setDetail('simple')}
          >
            {t('options.detailSimple')}
          </button>
          <button
            className={`seg__btn ${detail === 'detailed' ? 'seg__btn--active' : ''}`}
            onClick={() => setDetail('detailed')}
          >
            {t('options.detailDetailed')}
          </button>
        </div>
        <p className="panel__hint">{t('options.detailHint')}</p>
      </section>

      <section className="panel__section">
        <h3 className="panel__section-title">{t('options.overclockTitle')}</h3>
        <label className="switch">
          <input
            type="checkbox"
            checked={overclockEnabled}
            onChange={(e) => setOverclockEnabled(e.target.checked)}
          />
          {t('options.overclockToggle')}
        </label>
        {overclockEnabled ? (
          <label className="panel__field panel__field--col">
            <span className="panel__unit">
              {t('options.overclockMax', { x: maxClock.toFixed(1) })}
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
              ? t('options.overclockHintForward')
              : t('options.overclockHintReverse')
            : t('options.overclockHintOff')}
        </p>
      </section>
    </div>
  );
}

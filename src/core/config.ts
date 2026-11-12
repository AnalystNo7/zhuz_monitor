import type { IndicatorId, RemarkIndicator } from './types.ts';

export interface IndicatorConfig {
  title: string;
  short: string;
  /** Вес показателя Wn. Сумма весов равна 1. */
  weight: number;
  /** Норматив N: допустимое количество замечаний (циклов). */
  norm: number;
  /** Коэффициент kn: штраф за каждую единицу сверх норматива. */
  penalty: number;
}

export interface CategoryConfig {
  id: string;
  title: string;
  /** Показатель, к которому относится категория; `null` — в расчёте не участвует. */
  indicator: RemarkIndicator | null;
  /** Фрагменты, по которым категория узнаётся в свободном тексте ячейки. */
  keywords: string[];
}

export interface Config {
  indicators: Record<IndicatorId, IndicatorConfig>;
  /**
   * `flat` — норматив на документ целиком (так считается в реестре).
   * `per10pages` — норматив оформления и содержания на каждые 10 листов.
   */
  normMode: 'flat' | 'per10pages';
  /** Нижние границы зон: зелёная от `green`, жёлтая от `yellow`, ниже — красная. */
  zones: { green: number; yellow: number };
  acceptedStatuses: string[];
  rejectedStatuses: string[];
  /** Статусы замечаний, по которым решение ещё не принято: в расчёт не идут. */
  pendingStatuses: string[];
  categories: CategoryConfig[];
  /**
   * Показатель для принятого замечания, у которого категория не указана или не распознана.
   * `null` — такие замечания не учитывать.
   */
  uncategorizedIndicator: RemarkIndicator | null;
  /** Одинаковые по тексту замечания одного журнала считать одним: методика считает уникальные замечания. */
  mergeDuplicateRemarks: boolean;
  /** Если у замечания несколько категорий, оно считается один раз — по первому показателю из списка. */
  indicatorPriority: RemarkIndicator[];
  /** Значения колонки «Файл ЖУЗ», означающие согласование без замечаний. */
  noRemarksMarkers: string[];
}

/** Константы методики и принятые по проекту решения. */
export const DEFAULT_CONFIG: Config = {
  indicators: {
    design: { title: 'Качество оформления', short: 'Оформление', weight: 0.15, norm: 4, penalty: 1 },
    content: { title: 'Качество содержания', short: 'Содержание', weight: 0.35, norm: 8, penalty: 5 },
    repeats: { title: 'Качество устранения замечаний', short: 'Повторы', weight: 0.3, norm: 1, penalty: 10 },
    cycles: { title: 'Количество циклов согласования', short: 'Циклы', weight: 0.2, norm: 3, penalty: 15 },
  },
  normMode: 'flat',
  zones: { green: 90, yellow: 70 },
  acceptedStatuses: ['принято', 'согласовано с комментарием'],
  rejectedStatuses: ['отклонено'],
  pendingStatuses: ['новое', 'в работе', 'на рассмотрении'],
  uncategorizedIndicator: 'content',
  mergeDuplicateRemarks: true,
  // Порядок важен: категория определяется по первому совпадению.
  categories: [
    {
      id: 'content-change',
      title: 'Изменение / дополнение текстового и графического содержания документа',
      indicator: 'content',
      keywords: ['содержани', 'текстового', 'графического'],
    },
    {
      id: 'content-functional',
      title: 'Уточнение в части требований к функциональности',
      indicator: 'content',
      keywords: ['функциональност'],
    },
    {
      id: 'content-clarify',
      title: 'Уточнение / корректировка информации',
      indicator: 'content',
      // Встречается и в сокращённом виде: «Уточнение».
      keywords: ['информаци', 'уточнени'],
    },
    {
      id: 'content-terms',
      title: 'Ошибки в терминологии и определениях / сокращениях и расшифровка',
      indicator: 'content',
      keywords: ['терминолог', 'сокращени', 'расшифровк'],
    },
    {
      id: 'content-regulations',
      title: 'Корректировка с учетом положений / нормативных документов',
      indicator: 'content',
      keywords: ['нормативн', 'положени'],
    },
    {
      id: 'repeat',
      title: 'Учет ранее выданных замечаний',
      indicator: 'repeats',
      keywords: ['ранее выданн', 'повторн'],
    },
    {
      id: 'organizational',
      title: 'Организационные и процессные вопросы',
      indicator: null,
      keywords: ['организационн', 'процессн'],
    },
    {
      id: 'design-layout',
      title: 'Корректировка оформления и структуры документа',
      indicator: 'design',
      keywords: ['оформлени', 'структур'],
    },
    {
      id: 'design-spelling',
      title: 'Орфографические и грамматические ошибки',
      indicator: 'design',
      keywords: ['орфограф', 'грамматич', 'пунктуац'],
    },
    { id: 'other', title: 'Прочее', indicator: null, keywords: ['прочее'] },
  ],
  indicatorPriority: ['repeats', 'content', 'design'],
  noRemarksMarkers: ['без замечаний', 'нет замечаний', 'замечаний нет'],
};

export const INDICATOR_IDS: IndicatorId[] = ['design', 'content', 'repeats', 'cycles'];

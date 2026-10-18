export type OperatingPoint = {
  threshold: number;
  detected: number;
  leadHours: number;
  falseAlertPatients: number;
  episodesPer100Days: number;
};

export type EvaluationSplit = {
  rows: number;
  positiveRate: number;
  auroc: number;
  auprc: number;
  baselineAuroc: number;
  operatingPoint: OperatingPoint;
};

export const evaluationArtifact = {
  modelVersion: "v1",
  featureVersion: "v1",
  bestIteration: 111,
  selectedPolicy: "5pct_false_alert_patients",
  selectedThreshold: 0.09369306785703713,
  splits: {
    val: { rows: 117616, positiveRate: 0.021799755135355734, auroc: 0.8177403930979754, auprc: 0.13334867670223075, baselineAuroc: 0.7520228186313421, operatingPoint: { threshold: 0.09369306785703713, detected: 0.4552238805970149, leadHours: 32.5, falseAlertPatients: 0.05030542579949695, episodesPer100Days: 4.735346115902675 } },
    test: { rows: 118903, positiveRate: 0.02167312851652187, auroc: 0.8223371699878863, auprc: 0.13494962066831756, baselineAuroc: 0.7686579720483795, operatingPoint: { threshold: 0.09369306785703713, detected: 0.46096654275092935, leadHours: 34, falseAlertPatients: 0.04852624011502516, episodesPer100Days: 5.016478548721089 } },
    b_check: { rows: 761995, positiveRate: 0.014147074455869133, auroc: 0.7993183425658101, auprc: 0.07601061384295493, baselineAuroc: 0.0, operatingPoint: { threshold: 0.09369306785703713, detected: 0.34413309982486867, leadHours: 40, falseAlertPatients: 0.02338530066815145, episodesPer100Days: 3.9738017044153833 } },
  } satisfies Record<string, EvaluationSplit>,
};

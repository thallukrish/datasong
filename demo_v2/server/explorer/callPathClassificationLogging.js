const arr = (value) => Array.isArray(value) ? value : [];
const text = (value, max = 360) => {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

export const withCallPathClassificationLogging = (Base) => class CallPathClassificationLoggingExplorer extends Base {
  async getSemanticUpdate(args) {
    const result = await super.getSemanticUpdate(args);
    if (!String(args?.dynamicPrompt || '').startsWith('MODE call-path-business-seed-classification-v5')) return result;

    const parsed = result?.parsed || {};
    await this.appendRunLog({
      type: 'pass1_call_path_classification_applied',
      call: result?.callNumber,
      explorationStep: this.state?.step,
      timestamp: new Date().toISOString(),
      summary: text(parsed?.summary, 400),
      paths: arr(parsed?.paths).map((item) => ({
        pathId: String(item?.pathId || ''),
        classification: String(item?.classification || ''),
        confidence: Number(item?.confidence || 0),
        flowTitle: text(item?.flowTitle, 180),
        businessActor: text(item?.businessActor, 220),
        businessIntent: text(item?.businessIntent, 280),
        completionCondition: text(item?.completionCondition, 300),
        businessOutcome: text(item?.businessOutcome, 320),
        businessPriority: Number(item?.businessPriority || 0),
        priorityClass: String(item?.priorityClass || ''),
        priorityReason: text(item?.priorityReason, 300),
        semanticBoundaryAt: text(item?.semanticBoundaryAt, 300),
        coherentThroughSignature: text(item?.coherentThroughSignature, 500),
        reason: text(item?.reason, 300)
      }))
    });
    return result;
  }
};

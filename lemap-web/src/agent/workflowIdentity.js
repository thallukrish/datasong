function slug(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

export function workflowKeyFromGoal(goal = '') {
  return slug(goal) || 'workflow';
}

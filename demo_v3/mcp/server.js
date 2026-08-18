import { createServer } from 'node:http';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
import { runtime } from '../server/runtime.js';

function result(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}

function buildServer() {
  const server = new McpServer({ name: 'datasong-demo-v3', version: '0.1.0' });

  server.registerTool('datasong.start_episode', {
    description: 'Start an interactive DataSong v3 teacher/student episode. Until the v2 evidence adapter is wired, omitting packet starts the canonical plumbing fixture.',
    inputSchema: z.object({ packet: z.unknown().optional() })
  }, async ({ packet }) => result(await runtime.startEpisode({ packet })));

  server.registerTool('datasong.get_state', {
    description: 'Return the current DataSong v3 episode/navigation state.'
  }, async () => result(runtime.getState()));

  server.registerTool('datasong.get_evidence', {
    description: 'Return the current canonical evidence packet for independent teacher scoring and student scoring.'
  }, async () => result(runtime.getEvidence()));

  server.registerTool('datasong.apply_scores', {
    description: 'Apply STUDENT scores to DataSong deterministic phase policy. Teacher scores must not be used here.',
    inputSchema: z.object({ scores: z.unknown() })
  }, async ({ scores }) => result(await runtime.applyScores(scores)));

  server.registerTool('datasong.advance', {
    description: 'Advance DataSong using the already-applied student semantic decision.'
  }, async () => result(await runtime.advance()));

  server.registerTool('datasong.get_run_log', {
    description: 'Return the append-only log for the active episode.'
  }, async () => result(await runtime.getRunLog()));

  server.registerTool('datasong.reset_or_restore', {
    description: 'Reset the in-memory demo_v3 episode scaffold. Checkpoint restoration will be added with the real student runtime.'
  }, async () => result(await runtime.resetOrRestore()));

  server.registerTool('student.score', {
    description: 'Score a canonical evidence packet with the student. The current implementation is an explicitly neutral/mock scorer for MCP plumbing validation.',
    inputSchema: z.object({ packet: z.unknown().optional() })
  }, async ({ packet }) => result(runtime.studentScore(packet)));

  server.registerTool('student.train', {
    description: 'Train/update the student on a target. The scaffold memorizes the exact target only to validate orchestration; UniXcoder will replace this implementation.',
    inputSchema: z.object({ packet: z.unknown().optional(), target: z.unknown() })
  }, async ({ packet, target }) => result(await runtime.studentTrain({ packet, target })));

  server.registerTool('student.evaluate', {
    description: 'Evaluate the current student on a supplied or active evidence packet.',
    inputSchema: z.object({ packet: z.unknown().optional() })
  }, async ({ packet }) => result(runtime.studentEvaluate(packet)));

  server.registerTool('student.get_metrics', {
    description: 'Return student runtime metrics.'
  }, async () => result(runtime.getMetrics()));

  server.registerTool('student.save_checkpoint', {
    description: 'Checkpoint hook reserved for the real UniXcoder runtime.'
  }, async () => result({ implemented: false, reason: 'UniXcoder runtime not wired yet' }));

  server.registerTool('student.restore_checkpoint', {
    description: 'Checkpoint restore hook reserved for the real UniXcoder runtime.',
    inputSchema: z.object({ checkpoint: z.string() })
  }, async ({ checkpoint }) => result({ implemented: false, checkpoint, reason: 'UniXcoder runtime not wired yet' }));

  server.registerTool('training.add_teacher_sample', {
    description: 'Persist ChatGPT teacher supervision for the active real evidence state.',
    inputSchema: z.object({
      packet: z.unknown().optional(),
      target: z.unknown(),
      weaknesses: z.array(z.string()).optional(),
      explanation: z.string().optional()
    })
  }, async ({ packet, target, weaknesses, explanation }) => result(await runtime.addTeacherSample({
    packet,
    target,
    weaknesses: weaknesses || [],
    explanation: explanation || ''
  })));

  server.registerTool('training.add_synthetic_batch', {
    description: 'Persist teacher-generated targeted synthetic evidence packets for the active episode.',
    inputSchema: z.object({ samples: z.array(z.unknown()) })
  }, async ({ samples }) => result(await runtime.addSyntheticBatch({ samples })));

  server.registerTool('training.get_episode', {
    description: 'Read an episode training log.',
    inputSchema: z.object({ episodeId: z.number().int().positive().optional() })
  }, async ({ episodeId }) => result(await runtime.getEpisode(episodeId)));

  server.registerTool('training.get_loss_history', {
    description: 'Return the recorded training loss history for an episode.',
    inputSchema: z.object({ episodeId: z.number().int().positive().optional() })
  }, async ({ episodeId }) => result(await runtime.getLossHistory(episodeId)));

  server.registerTool('training.get_skill_metrics', {
    description: 'Return per-semantic-skill metrics. Placeholder until real evaluation is wired.'
  }, async () => result(runtime.getSkillMetrics()));

  server.registerTool('training.list_checkpoints', {
    description: 'List locally persisted student checkpoints.'
  }, async () => result(await runtime.listCheckpoints()));

  return server;
}

const handler = createMcpHandler(buildServer);
const nodeHandler = toNodeHandler(handler);
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();
const port = Number(process.env.DATASONG_MCP_PORT || 3113);
const host = process.env.DATASONG_MCP_HOST || '127.0.0.1';

createServer((req, res) => {
  if (!validateHost(req, res) || !validateOrigin(req, res)) return;
  void nodeHandler(req, res);
}).listen(port, host, () => {
  console.error(`[DataSong demo_v3 MCP] http://${host}:${port}/mcp`);
  console.error('[DataSong demo_v3 MCP] teacher/student plumbing scaffold; production navigation must advance only from student scores');
});

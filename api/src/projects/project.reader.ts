import type { RecordReader } from '../paperwork/adapters';
import { Project, ProjectMember } from './project.entities';

/** A project for reports about it («Паспорт проєкту», «Підсумковий звіт»), by the keys of PROJECT_SCHEMA. */
export const PROJECT_READER: RecordReader = {
  async resolve(id, m) {
    const p = await m.findOneBy(Project, { id });
    if (!p) return null;
    const members = await m.find(ProjectMember, {
      where: { projectId: id },
      order: { joinedAt: 'ASC', userId: 'ASC' },
    });
    return {
      values: {
        title: p.title,
        description: p.description,
        stage: p.stage,
        startDate: p.startDate,
        deadline: p.deadline,
        progress: p.progress,
        accomplishments: p.accomplishments,
        sources: p.sources,
        memberIds: members.map((x) => x.userId),
        createdById: p.createdById,
        createdAt: p.createdAt.toISOString(),
        archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
      },
    };
  },
};

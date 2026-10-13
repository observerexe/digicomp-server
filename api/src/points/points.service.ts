import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PointsEntry } from './points-entry.entity';

@Injectable()
export class PointsService {
  constructor(
    @InjectRepository(PointsEntry) private repo: Repository<PointsEntry>,
    @InjectDataSource() private ds: DataSource,
  ) {}

  async mine(userId: string) {
    const rows = await this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    const balance = rows.length
      ? Number(
          (
            await this.ds.query(
              'SELECT COALESCE(SUM(amount),0)::int AS total FROM points_ledger WHERE user_id = $1',
              [userId],
            )
          )[0].total,
        )
      : 0;
    return { balance, history: rows };
  }

  leaderboard() {
    return this.ds.query(
      `SELECT u.id, u.name, COALESCE(SUM(p.amount),0)::int AS total
       FROM users u
       LEFT JOIN points_ledger p ON p.user_id = u.id
       GROUP BY u.id, u.name
       ORDER BY total DESC, u.name ASC`,
    );
  }
}

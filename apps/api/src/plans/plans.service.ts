import { PlanDocumentSchema, type PlanDocument, EMPTY_PLAN_DOCUMENT } from '@home-design/plan-schema'
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull, Like, Repository } from 'typeorm'
import { AssetsService } from '../assets/assets.service'
import { CreatePlanDto } from './dto/create-plan.dto'
import { ImportPlanDto } from './dto/import-plan.dto'
import { ListPlansDto } from './dto/list-plans.dto'
import { Plan } from './plan.entity'
import { PlanLike } from './plan-like.entity'

@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    private readonly assets: AssetsService,
    @Optional() @InjectRepository(PlanLike) private readonly likes?: Repository<PlanLike>,
  ) {}

  async create(ownerId: string, dto: CreatePlanDto) {
    return this.plans.save(
      this.plans.create({
        ownerId,
        name: dto.name.trim(),
        documentJson: structuredClone(EMPTY_PLAN_DOCUMENT),
        schemaVersion: EMPTY_PLAN_DOCUMENT.schemaVersion,
        revision: 1,
        thumbnailUrl: null,
        isPublic: false,
      }),
    )
  }

  async importPlan(ownerId: string, dto: ImportPlanDto) {
    const documentJson = await this.parseDocument(dto.documentJson)
    return this.plans.save(
      this.plans.create({
        ownerId,
        name: dto.name.trim(),
        documentJson,
        schemaVersion: documentJson.schemaVersion,
        revision: 1,
        thumbnailUrl: null,
        isPublic: false,
      }),
    )
  }

  async list(ownerId: string, query: ListPlansDto) {
    const where = {
      ownerId,
      deletedAt: IsNull(),
      ...(query.keyword?.trim() ? { name: Like(`%${query.keyword.trim()}%`) } : {}),
    }
    const [items, total] = await this.plans.findAndCount({
      where,
      select: {
        id: true,
        name: true,
        revision: true,
        schemaVersion: true,
        thumbnailUrl: true,
        isPublic: true,
        createdAt: true,
        updatedAt: true,
      },
      order: { updatedAt: 'DESC' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    })
    return { items, page: query.page, pageSize: query.pageSize, total }
  }

  async listDiscover(query: ListPlansDto, viewerId?: string) {
    const builder = this.plans
      .createQueryBuilder('plan')
      .leftJoinAndSelect('plan.owner', 'owner')
      .leftJoin('plan.likes', 'like')
      .where('plan.is_public = :isPublic AND plan.deleted_at IS NULL', { isPublic: true })
      .select([
        'plan.id',
        'plan.name',
        'plan.revision',
        'plan.schemaVersion',
        'plan.thumbnailUrl',
        'plan.isPublic',
        'plan.createdAt',
        'plan.updatedAt',
        'owner.id',
        'owner.username',
        'owner.nickname',
      ])
      .addSelect('COUNT(like.id)', 'likeCount')
      .groupBy('plan.id')
      .addGroupBy('owner.id')
      .orderBy(query.sort === 'likes' ? 'likeCount' : 'plan.updatedAt', 'DESC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
    if (query.keyword?.trim()) builder.andWhere('plan.name LIKE :keyword', { keyword: `%${query.keyword.trim()}%` })
    const [items, total] = await builder.getManyAndCount()
    const rawCounts = await builder.getRawMany<{ plan_id: string; likeCount: string }>()
    const counts = new Map(rawCounts.map((row) => [row.plan_id, Number(row.likeCount)]))
    const likedIds = viewerId
      ? new Set((await this.likes?.find({ where: { userId: viewerId }, select: { planId: true } }) ?? []).map((like) => like.planId))
      : new Set<string>()
    return {
      items: items.map((plan) => ({
        id: plan.id,
        name: plan.name,
        revision: plan.revision,
        schemaVersion: plan.schemaVersion,
        thumbnailUrl: plan.thumbnailUrl,
        isPublic: plan.isPublic,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
        likeCount: counts.get(plan.id) ?? 0,
        liked: likedIds.has(plan.id),
        author: { username: plan.owner.username, nickname: plan.owner.nickname },
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    }
  }

  async getDiscover(id: string, viewerId?: string) {
    const plan = await this.plans.findOne({
      where: { id, isPublic: true, deletedAt: IsNull() },
      relations: { owner: true },
    })
    if (!plan) throw new NotFoundException({ code: 'PUBLIC_PLAN_NOT_FOUND', message: '公开方案不存在或已取消公开' })
    if (plan.documentJson.schemaVersion !== plan.schemaVersion) {
      throw new ConflictException({ code: 'PLAN_SCHEMA_MISMATCH', message: '方案版本数据不一致，请联系管理员' })
    }
    const likeCount = (await this.likes?.count({ where: { planId: id } })) ?? 0
    const liked = viewerId ? Boolean(await this.likes?.findOne({ where: { planId: id, userId: viewerId } })) : false
    return {
      ...plan,
      likeCount,
      liked,
      owner: { username: plan.owner.username, nickname: plan.owner.nickname },
    }
  }

  async copyPublic(ownerId: string, id: string) {
    const source = await this.getDiscover(id, ownerId)
    return this.plans.save(
      this.plans.create({
        ownerId,
        name: `${source.name}（副本）`.slice(0, 100),
        documentJson: structuredClone(source.documentJson),
        schemaVersion: source.schemaVersion,
        revision: 1,
        thumbnailUrl: null,
        isPublic: false,
      }),
    )
  }

  async toggleLike(userId: string, id: string) {
    if (!this.likes) throw new NotFoundException({ code: 'LIKES_UNAVAILABLE', message: '点赞功能暂不可用' })
    await this.getDiscover(id, userId)
    const existing = await this.likes.findOne({ where: { planId: id, userId } })
    if (existing) await this.likes.remove(existing)
    else await this.likes.save(this.likes.create({ planId: id, userId }))
    return { liked: !existing, likeCount: await this.likes.count({ where: { planId: id } }) }
  }

  async updateVisibility(ownerId: string, id: string, isPublic: boolean) {
    const result = await this.plans.update({ id, ownerId, deletedAt: IsNull() }, { isPublic })
    if (result.affected !== 1) throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: '方案不存在' })
    return this.get(ownerId, id)
  }

  async get(ownerId: string, id: string) {
    const plan = await this.plans.findOne({ where: { id, ownerId, deletedAt: IsNull() } })
    if (!plan) throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: '方案不存在' })
    if (plan.documentJson.schemaVersion !== plan.schemaVersion) {
      throw new ConflictException({ code: 'PLAN_SCHEMA_MISMATCH', message: '方案版本数据不一致，请联系管理员' })
    }
    return plan
  }

  async update(ownerId: string, id: string, expectedRevision: number, input: unknown) {
    await this.get(ownerId, id)
    const documentJson = await this.parseDocument(input)
    const result = await this.plans
      .createQueryBuilder()
      .update(Plan)
      .set({
        documentJson,
        schemaVersion: documentJson.schemaVersion,
        revision: () => 'revision + 1',
      })
      .where('id = :id AND owner_id = :ownerId AND revision = :expectedRevision AND deleted_at IS NULL', {
        id,
        ownerId,
        expectedRevision,
      })
      .execute()

    if (result.affected !== 1) {
      throw new ConflictException({ code: 'PLAN_VERSION_CONFLICT', message: '方案已在其他页面更新，请刷新后重试' })
    }
    return this.get(ownerId, id)
  }

  async rename(ownerId: string, id: string, name: string) {
    // Update only the name, so a concurrent document save cannot be overwritten
    // by a stale entity snapshot. Deleted plans must remain deleted.
    const result = await this.plans.update({ id, ownerId, deletedAt: IsNull() }, { name: name.trim() })
    if (result.affected !== 1) throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: '方案不存在' })
    return this.get(ownerId, id)
  }

  async remove(ownerId: string, id: string) {
    await this.get(ownerId, id)
    await this.plans.softDelete({ id, ownerId })
    return { id }
  }

  private async parseDocument(input: unknown): Promise<PlanDocument> {
    const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8')
    if (bytes > 2 * 1024 * 1024) {
      throw new BadRequestException({ code: 'PLAN_TOO_LARGE', message: '方案数据不能超过 2MB' })
    }
    const result = PlanDocumentSchema.safeParse(input)
    if (!result.success) {
      throw new BadRequestException({
        code: 'INVALID_PLAN_DOCUMENT',
        message: result.error.issues
          .map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`)
          .join('; '),
      })
    }
    if (!(await this.assets.areEnabledAssetIds(result.data.furniture.map((item) => item.assetId)))) {
      throw new BadRequestException({
        code: 'INVALID_PLAN_DOCUMENT',
        message: 'furniture.assetId: 家具素材不存在或已停用',
      })
    }
    return result.data
  }
}

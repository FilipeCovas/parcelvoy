import App from '../app'
import { Database } from 'config/database'
import { RequestError } from '../core/errors'
import { SearchParams } from '../core/searchParams'
import Journey, { JourneyParams, UpdateJourneyParams } from './Journey'
import { JourneyStep, JourneyEntrance, JourneyUserStep, JourneyStepMap, toJourneyStepMap, JourneyStepChild } from './JourneyStep'
import { CampaignDelivery } from 'campaigns/Campaign'
import { raw } from '../core/Model'

export const pagedJourneys = async (params: SearchParams, projectId: number) => {
    return await Journey.searchParams(
        params,
        ['name'],
        b => b.where({ project_id: projectId }),
    )
}

export const allJourneys = async (projectId: number): Promise<Journey[]> => {
    return await Journey.all(qb => qb.where('project_id', projectId))
}

export const createJourney = async (projectId: number, params: JourneyParams): Promise<Journey> => {
    return App.main.db.transaction(async trx => {

        const journey = await Journey.insertAndFetch({
            ...params,
            project_id: projectId,
        }, trx)

        // auto-create entrance step
        await JourneyEntrance.create(journey.id, undefined, trx)

        return journey
    })
}

export const getJourney = async (id: number, projectId: number): Promise<Journey> => {
    const journey = await Journey.find(id, qb => qb.where('project_id', projectId))
    if (!journey) throw new RequestError('Journey not found', 404)
    return journey
}

export const updateJourney = async (id: number, params: UpdateJourneyParams): Promise<Journey> => {
    return await Journey.updateAndFetch(id, params)
}

export const deleteJourney = async (id: number): Promise<void> => {
    await Journey.updateAndFetch(id, { deleted_at: new Date() })
}

export const getJourneySteps = async (journeyId: number, db?: Database): Promise<JourneyStep[]> => {
    return await JourneyStep.all(qb => qb.where('journey_id', journeyId), db)
}

export const getJourneyStepChildren = async (stepId: number) => {
    return await JourneyStepChild.all(q => q.where('step_id', stepId))
}

const getAllJourneyStepChildren = async (journeyId: number, db?: Database): Promise<JourneyStepChild[]> => {
    return await JourneyStepChild.all(
        q => q.whereIn('step_id', JourneyStep.query(db).select('id').where('journey_id', journeyId)),
        db,
    )
}

export const getJourneyStepMap = async (journeyId: number) => {
    const [steps, children] = await Promise.all([
        getJourneySteps(journeyId),
        getAllJourneyStepChildren(journeyId),
    ])
    return toJourneyStepMap(steps, children)
}

export const setJourneyStepMap = async (journeyId: number, stepMap: JourneyStepMap) => {
    return await App.main.db.transaction(async trx => {

        const [steps, children] = await Promise.all([
            getJourneySteps(journeyId, trx),
            getAllJourneyStepChildren(journeyId, trx),
        ])

        // Create or update steps
        for (const [external_id, { type, x = 0, y = 0, data = {} }] of Object.entries(stepMap)) {
            const idx = steps.findIndex(s => s.external_id === external_id)
            if (idx === -1) {
                steps.push(await JourneyStep.insertAndFetch({
                    journey_id: journeyId,
                    type,
                    external_id,
                    data,
                    x,
                    y,
                }, trx))
            } else {
                const step = steps[idx]
                steps[idx] = await JourneyStep.updateAndFetch(step.id, {
                    type,
                    external_id,
                    data,
                    x,
                    y,
                }, trx)
            }
        }

        // Delete removed or unused steps
        const deleteSteps: number[] = []
        let i = 0
        while (i < steps.length) {
            const step = steps[i]
            if (!stepMap[step.external_id]) {
                deleteSteps.push(step.id)
                steps.splice(i, 1)
                continue
            }
            i++
        }
        if (deleteSteps.length) {
            await JourneyStep.delete(q => q.whereIn('id', deleteSteps), trx)
        }

        const deleteChildSteps: number[] = []
        for (const step of steps) {
            const list = stepMap[step.external_id]?.children ?? []
            const childIds: number[] = []

            for (const { external_id, data = {} } of list) {
                const child = steps.find(s => s.external_id === external_id)
                if (!child) continue
                const idx = children.findIndex(sc => sc.step_id === step.id && sc.child_id === child.id)
                let stepChild: JourneyStepChild
                if (idx === -1) {
                    children.push(stepChild = await JourneyStepChild.insertAndFetch({
                        step_id: step.id,
                        child_id: child.id,
                        data,
                    }, trx))
                } else {
                    stepChild = children[idx]
                    children[idx] = await JourneyStepChild.updateAndFetch(stepChild.id, {
                        data,
                    }, trx)
                }
                childIds.push(stepChild.child_id)
            }

            i = 0
            while (i < children.length) {
                const stepChild = children[i]
                if (stepChild.step_id === step.id && !childIds.includes(stepChild.child_id)) {
                    deleteChildSteps.push(stepChild.id)
                    children.splice(i, 1)
                    continue
                }
                i++
            }
        }
        if (deleteChildSteps.length) {
            await JourneyStepChild.delete(q => q.whereIn('id', deleteChildSteps), trx)
        }

        return toJourneyStepMap(steps, children)
    })
}

export const getJourneyStep = async (id?: number): Promise<JourneyStep | undefined> => {
    if (!id) return
    return await JourneyStep.first(db => db.where('id', id))
}

export const getUserJourneyIds = async (userId: number): Promise<number[]> => {
    return await JourneyUserStep.all(
        db => db.where('user_id', userId)
            .select('journey_id'),
    ).then(items => items.map(item => item.journey_id))
}

export const getUserJourneyStep = async (userId: number, stepId: number, type = 'completed'): Promise<JourneyUserStep | undefined> => {
    return await JourneyUserStep.first(
        db => db.where('step_id', stepId)
            .where('user_id', userId)
            .where('type', type)
            .orderBy('created_at', 'desc'),
    )
}

export const getJourneyEntrance = async (journeyId: number):Promise<JourneyStep | undefined> => {
    return await JourneyStep.first(
        db => db.where('type', JourneyEntrance.type)
            .where('journey_id', journeyId),
    )
}

export const lastJourneyStep = async (userId: number, journeyId: number): Promise<JourneyUserStep | undefined> => {
    return await JourneyUserStep.first(
        db => db.where('journey_id', journeyId)
            .where('user_id', userId)
            .orderBy('created_at', 'desc')
            .orderBy('id', 'desc'),
    )
}

interface JourneyStepStats {
    [external_id: string]: {
        users: number
        delivery?: CampaignDelivery
    }
}

export const getJourneyStepStats = async (journeyId: number) => {

    const [steps, userCounts] = await Promise.all([
        getJourneySteps(journeyId),
        (JourneyUserStep.query()
            .with(
                'latest_journey_steps',
                raw('SELECT step_id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY id DESC) AS rn FROM journey_user_step where journey_id = ' + journeyId),
            )
            .select('step_id')
            .count('* as users')
            .from('latest_journey_steps')
            .where('rn', 1)
            .groupBy('step_id')) as Promise<Array<{ step_id: number, users: number }>>,
    ])

    return steps.reduce<JourneyStepStats>((a, { external_id, id }) => {
        a[external_id] = {
            users: userCounts.find(uc => uc.step_id === id)?.users ?? 0,
        }
        return a
    }, {})
}
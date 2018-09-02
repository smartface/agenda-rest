import {promisify} from 'util';
import Agenda from 'agenda';
import settings from '../settings';
import {bootstrapKoaApp} from './util';
import {defineJob, jobOperations, jobAssertions, promiseJobOperation} from './job';

const {app, router} = bootstrapKoaApp();

const agenda = new Agenda({
  db: {
    address: settings.agendaMongoUrl,
    collection: settings.collection
  }
});

const jobsReady = agenda._ready
  .then(async () => {
    const jobs = agenda._mdb.collection(settings.definitions);
    jobs.toArray = () => {
      const jobsCursor = jobs.find();
      return promisify(jobsCursor.toArray).bind(jobsCursor)();
    };
    await jobs.toArray()
      .then(jobsArray => Promise.all(jobsArray.map(job => defineJob(job, jobs, agenda))));

    await agenda.start();
    return jobs;
  });

const getJobMiddleware = (jobAssertion, jobOperation, errorCode = 400) => async (ctx, next) => {
  const job = ctx.request.body || {};
  if (ctx.params.jobName) {
    job.name = ctx.params.jobName;
  }
  const jobs = await jobsReady;
  ctx.body = await promiseJobOperation(job, jobs, agenda, jobAssertion, jobOperation)
    .catch(err => ctx.throw(errorCode, err));
  await next();
};

router.get('/api/job', async (ctx, next) => {
  ctx.body = await jobsReady.then(jobs => jobs.toArray());
  await next();
});

router.post('/api/job', getJobMiddleware(jobAssertions.notExists, jobOperations.create));

router.del('/api/job/:jobName', getJobMiddleware(jobAssertions.alreadyExists, jobOperations.delete));

router.put('/api/job/:jobName', getJobMiddleware(jobAssertions.alreadyExists, jobOperations.update));

router.post('/api/job/once', getJobMiddleware(jobAssertions.alreadyExists, jobOperations.once));

router.post('/api/job/every', getJobMiddleware(jobAssertions.alreadyExists, jobOperations.every));

router.post('/api/job/now', getJobMiddleware(jobAssertions.alreadyExists, jobOperations.now));

router.post('/api/job/cancel', getJobMiddleware(jobAssertions.doNotAssert, jobOperations.cancel));

export {app, router, agenda, jobsReady};
export default app;

const express=require('express');
const controller=require('../controllers/theme.controller');
const isAuthenticated=require('../middlewares/isAuthenticated');
const checkAnyPermission=require('../middlewares/checkAnyPermission');
const aiAgentContext=require('../middlewares/aiAgentContext');
const {ensureThemeTables}=require('../services/theme.service');
module.exports=prisma=>{const router=express.Router();router.use((req,res,next)=>{req.prisma=prisma;next();});router.use(isAuthenticated(prisma));router.use(aiAgentContext);router.use(async(req,res,next)=>{try{await ensureThemeTables(prisma);next();}catch(error){next(error);}});const read=checkAnyPermission(['settings_read','settings_update','dashboard_view']);const manage=checkAnyPermission(['settings_update','roles_update']);router.get('/active',read,controller.active);router.get('/presets',read,controller.catalog);router.get('/',read,controller.list);router.post('/',manage,controller.create);router.get('/:id',read,controller.get);router.patch('/:id',manage,controller.update);router.delete('/:id',manage,controller.archive);router.post('/:id/publish',manage,controller.publish);router.post('/:id/clone',manage,controller.clone);router.post('/:id/rollback/:version',manage,controller.rollback);router.get('/:id/export',read,controller.exportTheme);return router;};

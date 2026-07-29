# Deployment Guide

## Pre-Deployment Checklist

### Code Quality
- [ ] Remove development-only files:
  - `app/actions/dev-auth.ts` - Replace with production auth
  - Debug `console.log("[v0] ...")` statements
- [ ] Run type checking: `pnpm type-check`
- [ ] Lint code: `pnpm lint`
- [ ] Test authentication flow
- [ ] Verify all API routes work

### Security
- [ ] Set strong `BETTER_AUTH_SECRET` (32+ chars)
- [ ] Enable email verification in auth form
- [ ] Set `NODE_ENV=production`
- [ ] Configure CORS properly
- [ ] Enable rate limiting on API routes
- [ ] Use HTTPS for all URLs
- [ ] Set secure cookie flags in production

### Database
- [ ] Create Neon PostgreSQL database
- [ ] Run all migrations
- [ ] Verify schema with Drizzle
- [ ] Test database connections
- [ ] Set up automated backups
- [ ] Create database user with minimal permissions

### Environment Variables
```bash
# Required for production
DATABASE_URL=postgresql://user:password@ep-xxxxx.us-east-1.neon.tech/dbname
BETTER_AUTH_SECRET=<strong-secret-key>
BETTER_AUTH_URL=https://yourdomain.com
NODE_ENV=production

# Auto-set by Vercel
VERCEL_PROJECT_PRODUCTION_URL=yourdomain.com
VERCEL_ENV=production
```

## Deployment Steps

### 1. Prepare Repository
```bash
# Ensure all changes are committed
git status
git add .
git commit -m "Production deployment"

# Push to main branch
git push origin main
```

### 2. Vercel Deployment
1. Go to [vercel.com](https://vercel.com)
2. Import GitHub repository
3. Select project settings
4. Add environment variables
5. Deploy

### 3. Post-Deployment
1. Test sign-in at `https://yourdomain.com/sign-in`
2. Verify scanner page loads
3. Test database connection
4. Check error logs in Vercel dashboard
5. Monitor application metrics

## Fixing Common Issues

### Issue: Authentication Not Working
**Cause**: Better Auth session not configured  
**Fix**:
1. Verify `BETTER_AUTH_SECRET` is set
2. Check `BETTER_AUTH_URL` matches your domain
3. Verify database tables exist and have correct schema
4. Check browser cookies are not blocked

### Issue: Database Connection Failed
**Cause**: `DATABASE_URL` invalid or database unavailable  
**Fix**:
1. Verify Neon PostgreSQL is running
2. Check connection string format
3. Ensure database user has correct permissions
4. Test connection locally first

### Issue: QR Scanner Not Working
**Cause**: HTTPS or camera permission issue  
**Fix**:
1. Ensure deployed on HTTPS
2. Allow camera permission when prompted
3. Check browser console for errors
4. Verify jsQR library loaded

### Issue: CSV Export Failing
**Cause**: Missing exceljs dependency  
**Fix**:
```bash
pnpm add exceljs
```

## Monitoring & Maintenance

### Health Checks
- Monitor `https://yourdomain.com/api/auth/session`
- Check database query performance
- Monitor error rates in Vercel dashboard
- Set up alerts for failed deployments

### Log Locations
- **Vercel Logs**: Dashboard > Settings > Logs
- **Database Logs**: Neon console > Monitoring
- **Application Logs**: Browser console (F12)

### Performance Optimization
- Use Vercel Analytics for performance metrics
- Optimize images and assets
- Enable caching headers
- Monitor database query times

## Rollback Plan

If deployment issues occur:

```bash
# View deployment history
git log --oneline

# Revert to previous commit
git revert HEAD

# Push to trigger new deployment
git push origin main

# Or manually in Vercel dashboard:
# Deployments > Click previous > Promote to Production
```

## Security Headers

Add to `next.config.js` for production:

```javascript
async headers() {
  return [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'X-XSS-Protection', value: '1; mode=block' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=()' },
      ],
    },
  ]
}
```

## Database Backup & Recovery

### Automated Backups
- Neon provides automatic daily backups
- Configure backup retention in Neon dashboard
- Store backups in separate region for disaster recovery

### Manual Backup
```bash
# Backup database
pg_dump $DATABASE_URL > backup.sql

# Restore from backup
psql $DATABASE_URL < backup.sql
```

## Scaling Considerations

### Database
- Neon scales automatically with connection pooling
- Monitor connection count in dashboard
- Upgrade compute size if needed

### Application
- Vercel automatically scales serverless functions
- Monitor edge network performance
- Use CDN for static assets

### Analytics
- Enable Vercel Web Analytics
- Track user behavior
- Monitor error rates

## Support Resources

- **Vercel**: [vercel.com/help](https://vercel.com/help)
- **Neon**: [neon.tech/docs](https://neon.tech/docs)
- **Next.js**: [nextjs.org/docs](https://nextjs.org/docs)
- **Better Auth**: [better-auth.com](https://www.better-auth.com)

## Emergency Contacts

If critical issues occur:
1. Check Vercel status page
2. Contact Neon support for database issues
3. Review application logs for errors
4. Rollback to previous working deployment

---

**Last Updated**: July 2026  
**Version**: 1.0.0

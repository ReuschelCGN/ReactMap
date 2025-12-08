// @ts-check
/** @type {import('@rm/types').ExpressMiddleware} */
function requireAuth(req, res, next) {
  if (req.user) return next()
  return res.status(401).json({ status: 'error', reason: 'Authentication required' })
}

module.exports = { requireAuth }

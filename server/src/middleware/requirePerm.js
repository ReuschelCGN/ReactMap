// @ts-check
/**
 * Middleware to check if user has a specific permission
 * @param {string} permName - Name of the permission to check (e.g., 'fenceEditor', 'publicFences')
 * @returns {import('@rm/types').ExpressMiddleware}
 */
function requirePerm(permName) {
  return (req, res, next) => {
    // First check if user is authenticated
    if (!req.user) {
      return res.status(401).json({ status: 'error', reason: 'Authentication required' })
    }

    // Check if user has the permission
    const perms = req.user.perms || {}
    if (!perms[permName]) {
      return res.status(403).json({ 
        status: 'error', 
        reason: `Permission '${permName}' required` 
      })
    }

    return next()
  }
}

module.exports = { requirePerm }

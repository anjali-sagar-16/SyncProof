/**
 * Role-Based Access Control (RBAC) middleware factory.
 * Restricts access to routes based on allowed user roles.
 *
 * @param  {...string} allowedRoles - Array of roles permitted to access the route
 */
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required before checking permissions.',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Access denied. Role '${req.user.role}' is not authorized for this action. Allowed: [${allowedRoles.join(', ')}].`,
      });
    }

    next();
  };
}

module.exports = { authorizeRoles };

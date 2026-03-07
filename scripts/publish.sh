set -euxo pipefail
shopt -s dotglob
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
cd "${SCRIPT_DIR}/.."

npm run build
# - `--no-checkout` leaves the worktree empty so we can add files without issue
#   (has nothing to do with history)
# - `gh-pages` is the directory we're targeting
# - `origin/gh-pages` is the upstream, to ensure we can add on to the git history
git worktree add --no-checkout gh-pages origin/gh-pages
mv build/* gh-pages
cd gh-pages
git add .
date=`date '+%F %H:%M:%S'`
git commit -m "Publish $date" || $(exit 0)
git push origin HEAD:gh-pages
cd -
git worktree remove gh-pages

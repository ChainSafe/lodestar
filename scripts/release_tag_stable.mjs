console.log(`TODO, Run

git tag -am "v1.1.0" v1.1.0
git push --tag

Then, if possible

git checkout unstable
git merge stable

else

Open a PR to merge 'stable' into 'unstable' **with merge commit** 

`);

process.exit(1);

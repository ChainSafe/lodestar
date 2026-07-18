# Pull Request Review Policy

With a goal to share the load and direct PR reviews to domain experts we have put forth this policy to organize our efforts. We want to ensure that reviews are timely and we do not rely on one or two team members to conduct all reviews. This is also aimed at hopefully getting more eyes on code reviews. We want to, as a team, make sure that no one on the team feels the burden to "check all the code" or on the flip side of that for code that has not been well vetted to get merged. Its both a policy to protect people and the standards that we uphold as a team. All code owners on the team are responsible for the quality of code that gets merged.

This policy is not much different from the existing process that we already use. The goal is to explicitly outline where we can possibly improve and help spread the load so that no one team member feels "obligated" or "required" to look at everything.

### Requesting a Review

It is up to the author of a PR to manually add one, or two if they feel it appropriate, reviewers from the team. Currently all team members are auto-notified as CODEOWNERS that a review is required. We want to remove the noise of these blanket requests and increase the signal from the reviews where each individual can provide value.

It will then be the responsibility of that (those) team members to review the PR. It is 100% ok for others to also review the PR but this is strictly additional and not considered "necessary work". A "drive-by" review does not preclude the requested reviewer from their responsibility. This is aimed at distributing reviews amongst the team.

If should also be stated that team time is limited, so the author should ideally only request the reviewers that they want to look at the code. If you are not the requested reviewer, you are not required to review and you should not feel that you "need" to review the code.

### Responsibilities of the Reviewer

Being requested for a review does not mean that you are required to "approve" the PR. Requesting a review just means that the requested reviewer must/should add comments. This is true both before and after merge. Even if the PR got merged via approval of another team member, ideally the PR will still get reviewed by the requested person post-merge.

### Merging a PR

It is the responsibility of the author to merge a PR, after the PR is reviewed by the requested reviewer. Drive-by reviews "can" be considered as a green thumb for merge, but ideally the requested reviewers should be the ones that gate the PR for merging. This is up to the authors discretion. Authors should be the final arbiter of "what is good to merge".

### Requesting Additional Reviews

At any point in the review process, any team member, can request that another team member give a review. If this is requested, it should be considered a hard requirement for both the requested reviewer to give feedback and the author to wait for that feedback before merging. The goal of this is to allow for domain expertise where someone feels it is appropriate.

### Post-Merge Comments

Time is tight and its possible that reviews might get merged before the requested reviewer (or anyone else for that matter) has a change to look at the code.

At any point after a merge, anyone can add comments to a PR. These comments are considered "live" but it is on the commenter to notify the PR author. It should not be considered the PR authors job to pay attention to already closed PRs. There are a few possible resolutions to this situation. One solution is the comments can be left on the PR and the commenter can put up a new issue pointing to the comments. The commenter can also put up a PR to fix the issues directly, but ultimately its should be the work of the author of the original PR to address the comments (either in the new issue or via a new PR).

Vacation is anther time when this might come up. If the domain expert is on vacation and requested to look at the code, but the merge is time sensitive, it is possible for another team member to do their best with review and to help get the code merged. The requested review can help to serve as a signal for what PRs might need to be looked at when the team member returns. That way team members can focus efforts on just the PRs that others on the team would like highlighted.

### Review Arbitration

While not common, from time to time an author and a reviewer might disagree on a feature/idea/comment/fix/etc. The resolution for this will be to have a third-party arbiter weigh in. It can be anyone that any party chooses. It will be the arbiter that makes the final call. If the arbiter is not comfortable making the final decisions they may reach out to a different person to help with the decision.

### Reassignment of Reviews

If over time, we find that some team members are requested for, or doing too many reviews, either the team as a whole, or one of the team leads can reassign reviews from the overburdened reviewer to another team member. This is still a flexible part of the policy and will evolve over time. The goal of this will be to not get into a situation where one person is the "sole domain" expert for all domains. We should be able to share the load and if reassignment can help to train other team members it can be a valuable tool to grow the process and individual abilities.

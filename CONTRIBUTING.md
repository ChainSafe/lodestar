# Introduction

>First off, thank you for considering contributing to the Lodestar Chain. It's people like you that push the Ethereum ecosystem forward.

We are currently converting our project from JavaScript to TypeScript, if you are interested in contributing please message us on [gitter](https://gitter.im/chainsafe/lodestar-chain).

# Your First Contribution
> Unsure where to begin contributing to the Lodestar Chain? You can start by looking through these beginner and help-wanted issues:
> Beginner issues - issues which should only require a few lines of code, and a test or two.
> Help wanted issues - issues which should be a bit more involved than beginner issues.
> Both issue lists are sorted by total number of comments. While not perfect, number of comments is a reasonable proxy for impact a given change will have.

> At this point, you're ready to make your changes! Feel free to ask for help; everyone is a beginner at first.
>
> If a maintainer asks you to "rebase" your PR, they're saying that a lot of code has changed, and that you need to update your branch so it's easier to merge.

# Typescript

> If you're new to typescript, don't worry, so are we! For the more experienced typescript developers, if you notice any inconsistencies please make an issue so we can address it early!
> We chose typescript to stay consistent with the ethereum-js team, as they are moving towards typescript. It also helps while developing, as it points out obvious errors, such as trying to itterate over a string (oops!).

We're trying to follow a few rules (the linter should catch most of these):
1. Functions and variables should be camel case.
2. All functions should have paramters properly decalred with respective types, and they should contain a return type.
3. If a function accepts/returns `any`, commonly found in the spec, please use a [generic](https://www.typescriptlang.org/docs/handbook/generics.html) instead.
4. All declared variables should have a corresponding type.

# Getting started
>1. Create your own fork of the code
>2. Do the changes in your fork
>3. If you like the change and think the project could use it:
    * Be sure you have followed the code style for the project.
    * run the linter within lodestar (npm run lint) and fix any issues if they arrise.
    * Send a pull request.

> Small contributions such as fixing spelling errors, where the content is small enough to not be considered intellectual property, can be submitted by a contributor as a patch, without a CLA.
>
>As a rule of thumb, changes are obvious fixes if they do not introduce any new functionality or creative thinking. As long as the change does not affect functionality, some likely examples include the following:
>* Spelling / grammar fixes
>* Typo correction, white space and formatting changes
>* Comment clean up
>* Bug fixes that change default return values or error codes stored in constants
>* Adding logging messages or debugging output
>* Changes to ‘metadata’ files like Gemfile, .gitignore, build scripts, etc.
>* Moving source files from one directory or package to another

# How to report a bug
A few issue templates have been created, please fill out all the information so we can better diagnose your issue.

# Code review process
> The core team looks at Pull Requests on a regular basis. 

# Community
> You can chat with the core team on https://gitter.im/chainsafe/lodestar-chain. 

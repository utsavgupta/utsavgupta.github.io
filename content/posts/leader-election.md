---
title: "Leader election"
date: "2020-11-11"
slug: "leader-election"
tags: ["distributed systems", "go"]

description: "Learn about leader election and its implementation in Go."
---

<!-- <p align="center">
    <img src="/img/leader-election.jpg" class="banner"> <br />
    <span>Photo by <a href="https://unsplash.com/@markusspiske?utm_source=unsplash&amp;utm_medium=referral&amp;utm_content=creditCopyText">Markus Spiske</a> on <a href="https://unsplash.com/s/photos/leader?utm_source=unsplash&amp;utm_medium=referral&amp;utm_content=creditCopyText">Unsplash</a></span>
</p> -->

Recently all our services were replicated to multiple data centers on Google Cloud Platform. The REST API services scaled well without any code changes. However the batch jobs and their schedulers needed attention to ensure we avoid any kind of race conditions. 

Leader election is ubiquitous in today's world of distributed computing. Knowingly or unknowingly we use a multitude of tools that make use of leader election to ensure systems run like clockwork.

In this article will explore the idea, and one of its implementations in Go using Google Datastore for persisting data.


## What is leader election ?

Before I answer that question, we need to understand how modern web applications and services are deployed. Much of the deployment strategy is decided by non functional requirements of the project. Requirements such as minimum availability and response times are taken into consideration for deciding the amount of redundancy and the location of the deployments. For example, if we want to make a service highly available, we would need to make replicas of it. So even if an instance dies, there would always be other instances available to carry out the same duties.

Making deployments redundant present us with another problem of ensuring that no two instances of the same job are performing the same piece of work at the same time. That of course does not imply that two instances cannot run at the same time, they shouldn't just get in each others way that will result in the system becoming inconsistent.

Enter leader election.

**It is the process of *electing* one of the replicas as the *leader* and letting it decide what to do, while the other replicas either remain idle or follow the leader**. The decision depends on your use case. The leader may choose to perform a piece of task on its own, or it may decide to split the task into smaller chunks and distribute them to the other replicas.

## How can this be implemented ?

There are quite a few tools and techniques available for implementing leader election in your project. The one we explore here is based on an idea presented in this [video](https://www.youtube.com/watch?v=fTCY93FsNko) (double thumbs up 👍🏽👍🏽 to the folks at Microsoft for creating amazing documentation and training material). I quite liked this approach for its simplicity and the fact that it can work with any database system that features atomic operations.

### The job

As a contrived example, let us create a job that preaches how cool Go is. Every time the job is scheduled it says something preachy about the language. However, in case we decided to scale up our preachers, we'd like to ensure that we are not getting too preachy. That is to say that at any given point in time only one job gets to preach the message.

Our preacher is simple. It accepts a *StringWriter* as an argument and it preaches by writing the message to the string writer. Moreover since it is a preacher it likes to repeat the message, for which it accepts an integer indicating how many times the message should be printed.

We create a custom type, Job, which consists of a name and a doable (a function). In the next section we will create a scheduler which accepts a job that gets scheduled periodically.

```go
type Job struct {
	Name string
	Do   func(int)
}

func NewPreacher(name, writer io.StringWriter) Job {
	return Job{
		Name: name,
		Do: func(times int) {

            // Printing the same message without any pause may alienate my audience.
            // Thus I sleep for 1 second between each preaching.

			// Don't sleep before the first preaching
			sleep := false

			for i := 1; i <= times; i++ {

				if sleep {
					time.Sleep(1 * time.Second)
				}

				_, err := writer.WriteString("Go is the best modern programming language\n")

				if err != nil {
					logger.Error(err)
				}

				sleep = true
			}
		},
	}
}
```

### The scheduler

At the heart of our application is the scheduler. It is this component that on getting elected successfully schedules the job.

Before implementing the scheduling logic we need to create a data structure that would hold the lease information. **In our case we can define a lease as a temporary right to schedule a job.** It is important to understand that these leases need to be temporary to avoid a situation where a scheduler becomes the leader by getting the lease but eventually crashes. This would result in a deadlock wherein the previous leader is not available to work, yet other schedulers cannot become the new leader.

A lease can be uniquely identified by its job name, as there can be exactly one scheduler as the leader for a job. Thus, we can use the job name as a name key, and include only the leader name and expiry in the structure.

```go
type lease struct {
	Leader string
	Expiry time.Time
}
```

While creating a scheduler we need to assign it a name to be able to uniquely identify it in the election process. 

```go
type Scheduler func(jobs.Job, time.Duration)

func NewScheduler(nodeName string, client *datastore.Client) Scheduler {
	return func(ctx context.Context, job jobs.Job, t time.Duration) {
		for {
			time.Sleep(t)
			if becomeLeader(ctx, nodeName, job.Name, client, t) {
				job.Do(3) // the preacher prints the message thrice
			}
		}
	}
}
```

Finally we need to implement the `becomeLeader` function.

A scheduler can gain leadership in one of the following three scenarios
- There is no leader yet
- The scheduler is already the leader
- The lease of the previous leader has expired

Reading and writing of lease entities need to be done in a transaction to ensure we avoid any race conditions. To guarantee atomicity of our database operations we make use of the client's `RunInTransaction` function. 

```go
func becomeLeader(ctx context.Context, nodeName, jobName string, client *datastore.Client, t time.Duration) bool {

	_, err := client.RunInTransaction(ctx, func(tx *datastore.Transaction) error {
		var l lease

		key := datastore.NameKey("Lease", jobName, nil)

		err := tx.Get(key, &l)

		if err != nil && err != datastore.ErrNoSuchEntity {
			return err
		}

		// Become the leader only if an entry for the given job does not exist
		// OR the lease of the previous leader has already expired
		// OR the current scheduler was the previous leader
		if err == datastore.ErrNoSuchEntity || l.Expiry.Before(time.Now()) || l.Leader == nodeName {
			l.Leader = nodeName
			l.Expiry = time.Now().Add(t)
			_, err := tx.Put(key, &l)

			return err
		}

		return fmt.Errorf("Node %s could not become leader for job %s", nodeName, jobName)
	})

	return err == nil
	
}
```

## Putting the components together


```go
ctx := context.Background()
client, e := datastore.NewClient(ctx, "")

if e != nil {
	panic(e)
}

scheduler := NewScheduler("karmic-koala", client)
job := NewPreacher("go_preacher", os.Stdout)
scheduler(ctx, job, 1 * time.Minute) // schedule the job every minute
```

You are encouraged to play around with the working example available at [https://github.com/utsavgupta/go-leader-election](https://github.com/utsavgupta/go-leader-election). 

